const { app, BrowserWindow, shell, session, ipcMain, dialog, protocol, net } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

let mainWindow

// ── Security: Allowed API domains for CORS bypass ──────────────────────────────
const ALLOWED_API_DOMAINS = [
  'api.anthropic.com',
  'api.openai.com',
  'generativelanguage.googleapis.com',
  'api.x.ai',
]

// ── Python backend subprocess (Phase 1-3) ──────────────────────────────────────
const BACKEND_PORT = 8765
let pythonProcess = null
let backendReady = false

function startPythonBackend() {
  const cmd = 'python'
  const args = [
    '-m', 'uvicorn', 'backend.main:app',
    '--host', '127.0.0.1',
    '--port', String(BACKEND_PORT),
    '--no-access-log',
  ]

  try {
    pythonProcess = spawn(cmd, args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    console.warn('[backend] Failed to start Python subprocess:', err)
    return
  }

  const onData = (data) => {
    const text = data.toString()
    if (text.trim()) console.log('[backend]', text.trim())
    if (text.includes('Application startup complete')) {
      backendReady = true
      BrowserWindow.getAllWindows().forEach((w) =>
        w.webContents.send('backend:ready', { port: BACKEND_PORT })
      )
    }
  }

  pythonProcess.stdout.on('data', onData)
  pythonProcess.stderr.on('data', onData) // uvicorn writes startup info to stderr
  pythonProcess.on('error', (err) => {
    console.warn('[backend] spawn error (Python not installed?):', err.message)
    pythonProcess = null
  })
  pythonProcess.on('exit', (code) => {
    console.log(`[backend] exited with code ${code}`)
    backendReady = false
    pythonProcess = null
  })
}

function stopPythonBackend() {
  if (pythonProcess) {
    pythonProcess.kill('SIGTERM')
    pythonProcess = null
  }
}

// ── Vault path tracking (for IPC security validation) ─────────────────────────
/** 현재 로드된 볼트의 절대 경로 — vault:load-files 시 갱신 */
let currentVaultPath = null

// ── Vault IPC helpers (Phase 6) ────────────────────────────────────────────────

/**
 * Verify that filePath is strictly inside vaultPath (no path traversal).
 */
function isInsideVault(vaultPath, filePath) {
  const rel = path.relative(vaultPath, filePath)
  return !rel.startsWith('..') && !path.isAbsolute(rel)
}

/** 볼트 내 이미지 파일로 인정하는 확장자 */
const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i

/**
 * Detect image MIME type from file magic bytes.
 * Falls back to extension if magic bytes are not recognized.
 * Returns null for unknown/non-image files.
 */
function detectMime(buffer, absPath) {
  if (!buffer || buffer.length === 0) return null
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'image/png'
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg'
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'image/gif'
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return 'image/webp'
  if (buffer[0] === 0x42 && buffer[1] === 0x4D) return 'image/bmp'
  const head = buffer.slice(0, 64).toString('utf8')
  if (head.includes('<svg') || head.includes('<?xml')) return 'image/svg+xml'
  const ext = path.extname(absPath).slice(1).toLowerCase()
  return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
           gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp' }[ext] ?? null
}

/**
 * Read an image file and return a base64 data URL (used by legacy IPC handlers).
 */
function readImageAsDataUrl(absPath) {
  let buffer
  try { buffer = fs.readFileSync(absPath) } catch (err) {
    console.warn('[vault] readImageAsDataUrl: readFileSync failed:', absPath, err.message)
    return null
  }
  if (!buffer || buffer.length === 0) return null
  const mime = detectMime(buffer, absPath)
  if (!mime) { console.warn('[vault] readImageAsDataUrl: unrecognized format:', absPath); return null }
  return `data:${mime};base64,${buffer.toString('base64')}`
}

// ── Image registry cache (for rembrandt-img:// protocol handler) ───────────────
// Kept in main process memory so the protocol handler can resolve filenames
// without an IPC round-trip.

/** Original basename → { relativePath, absolutePath } */
let currentImageRegistry = {}
/**
 * Normalized basename (lowercase, spaces→underscores) → absolutePath
 * Built whenever the vault loads; allows O(1) lookup by normalized key.
 */
let currentNormalizedImageMap = {}

function buildNormalizedImageMap(registry) {
  const map = {}
  for (const [key, entry] of Object.entries(registry)) {
    const norm = key.toLowerCase().replace(/\s+/g, '_')
    if (!map[norm]) map[norm] = entry.absolutePath
  }
  return map
}

/**
 * Find an absolute path for a given normalized image name.
 * 1. O(1) lookup in normalizedMap (built from vault:load-files registry)
 * 2. Fast existsSync check in common Obsidian attachment folders
 * 3. Slow recursive directory search (fallback of last resort)
 */
function resolveImagePath(normalizedName) {
  function normStr(s) { return s.toLowerCase().replace(/\s+/g, '_') }
  // Obsidian stores images with a numeric sender-id prefix (e.g. "411542267_image.png")
  // but wikilinks often omit the prefix. Match if the registry key ends with '_' + normalizedName.
  function isMatch(candidate) {
    return candidate === normalizedName || candidate.endsWith('_' + normalizedName)
  }

  // 1. Registry lookup — exact then suffix match
  const fromRegistry = currentNormalizedImageMap[normalizedName]
  if (fromRegistry && fs.existsSync(fromRegistry)) return fromRegistry
  // Suffix scan (O(n) over registry, only when exact lookup fails)
  for (const [key, absPath] of Object.entries(currentNormalizedImageMap)) {
    if (isMatch(key) && fs.existsSync(absPath)) return absPath
  }

  if (!currentVaultPath) return null

  // 2. Fast path: scan common Obsidian attachment folders with normalized + suffix comparison.
  const COMMON = ['attachments', 'Attachments', 'assets', 'images', 'img', 'media', 'files']
  for (const folder of COMMON) {
    const folderPath = path.join(currentVaultPath, folder)
    let names
    try { names = fs.readdirSync(folderPath) } catch { continue }
    for (const name of names) {
      if (isMatch(normStr(name))) return path.join(folderPath, name)
    }
  }

  // 3. Slow path: recursive search with normalized + suffix comparison
  function searchDir(dir, depth) {
    if (depth > 8) return null
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return null }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const full = path.join(dir, e.name)
      if (isMatch(normStr(e.name))) return full
      // Prefer e.isDirectory(), fall back to statSync to follow symlinks/junctions
      let isDir = false
      try { isDir = e.isDirectory() } catch { /* ignore */ }
      if (!isDir) { try { isDir = fs.statSync(full).isDirectory() } catch { /* ignore */ } }
      if (isDir) { const r = searchDir(full, depth + 1); if (r) return r }
    }
    return null
  }
  return searchDir(currentVaultPath, 0)
}

// ── Register rembrandt-img:// custom protocol ─────────────────────────────────
// Must be called before app.ready — registers the scheme as "secure" so Chromium
// treats it like https:// (no mixed-content errors when served from http:// dev server).
protocol.registerSchemesAsPrivileged([
  { scheme: 'rembrandt-img', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
])

/**
 * Recursively collect all .md files, image files, AND subdirectory paths in dirPath.
 * - Skips hidden dirs/files (starting with '.')
 * - Stops at depth > 10
 * Returns { files: string[], folders: string[], images: string[] }
 *   files:   absolute paths to .md files
 *   folders: vault-relative paths to subdirectories (e.g. "미니언 시스템")
 *   images:  absolute paths to image files (경로만, 내용 읽지 않음)
 */
function collectVaultContents(vaultPath, dirPath, depth) {
  if (depth === undefined) depth = 0
  if (depth > 10) return { files: [], folders: [], images: [] }
  const files = []
  const folders = []
  const images = []
  let entries
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true })
  } catch (err) {
    console.warn('[vault] readdirSync failed for', dirPath, err.message)
    return { files: [], folders: [], images: [] }
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue  // skip hidden (.obsidian, etc.)
    const fullPath = path.join(dirPath, entry.name)

    // ── Strategy for Synology Drive / cloud-backed virtual filesystems ──
    // lstatSync can fail for "online-only" or Unicode-named files on virtual
    // file systems.  We use entry.isDirectory() (from withFileTypes) which is
    // reliable on most filesystems, then fall back to readdirSync for edge cases.

    // 1) If name ends with .md → collect as markdown file
    if (entry.name.toLowerCase().endsWith('.md')) {
      if (isInsideVault(vaultPath, fullPath)) {
        files.push(fullPath)
      }
      continue
    }

    // 2) If name is an image → collect path only (no content read)
    if (IMAGE_EXTENSIONS.test(entry.name) && isInsideVault(vaultPath, fullPath)) {
      images.push(fullPath)
      continue
    }

    // 3) Check isDirectory() before skipping by extension.
    //    Directories named like "3D.v2" or "assets.bak" have extensions but must
    //    still be recursed — entry.isDirectory() detects them correctly.
    let entryIsDir = false
    try { entryIsDir = entry.isDirectory() } catch { /* ignore — fallthrough to step 4 */ }

    if (!entryIsDir && /\.\w{1,10}$/.test(entry.name)) continue  // non-dir file with extension

    // 4) Either confirmed directory (entryIsDir=true) or no-extension entry
    //    (virtual FS fallback: readdirSync determines if it's a readable directory).
    try {
      const relPath = path.relative(vaultPath, fullPath).replace(/\\/g, '/')
      folders.push(relPath)
      const sub = collectVaultContents(vaultPath, fullPath, depth + 1)
      files.push(...sub.files)
      folders.push(...sub.folders)
      images.push(...sub.images)
    } catch {
      // Not a directory or not readable — skip silently
    }
  }
  return { files, folders, images }
}

// ── Register IPC handlers ─────────────────────────────────────────────────────

function registerVaultIpcHandlers() {
  // ── vault:select-folder ──────────────────────────────────────────────────────
  ipcMain.handle('vault:select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: '볼트 폴더 선택',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // ── vault:load-files ─────────────────────────────────────────────────────────
  ipcMain.handle('vault:load-files', (_event, vaultPath) => {
    if (!vaultPath || typeof vaultPath !== 'string') {
      throw new Error('Invalid vault path')
    }
    const resolvedVault = path.resolve(vaultPath)

    if (!fs.existsSync(resolvedVault)) {
      throw new Error(`볼트 경로가 존재하지 않습니다: ${resolvedVault}`)
    }

    currentVaultPath = resolvedVault
    const { files: filePaths, folders: folderRelPaths, images: imagePaths } = collectVaultContents(resolvedVault, resolvedVault)
    console.log(`[vault] ${filePaths.length}개 .md 파일, ${folderRelPaths.length}개 폴더, ${imagePaths.length}개 이미지 발견 (${resolvedVault})`)

    const files = []
    for (const absPath of filePaths) {
      try {
        const content = fs.readFileSync(absPath, 'utf-8')
        const relativePath = path.relative(resolvedVault, absPath).replace(/\\/g, '/')
        let mtime
        try { mtime = fs.statSync(absPath).mtimeMs } catch { /* ignore */ }
        files.push({ relativePath, absolutePath: absPath, content, mtime })
      } catch (err) {
        console.warn('[vault] Failed to read', absPath, err.message)
      }
    }

    // 이미지 파일: 내용이 아닌 경로만 레지스트리로 반환 (filename → {relativePath, absolutePath})
    const imageRegistry = {}
    for (const absPath of imagePaths) {
      const filename = path.basename(absPath)
      const relativePath = path.relative(resolvedVault, absPath).replace(/\\/g, '/')
      // 동일 파일명 충돌 시 첫 번째 발견된 것 우선 (Obsidian 동작과 동일)
      if (!imageRegistry[filename]) {
        imageRegistry[filename] = { relativePath, absolutePath: absPath }
      }
    }

    // Keep in-memory copy for the rembrandt-img:// protocol handler
    currentImageRegistry = imageRegistry
    currentNormalizedImageMap = buildNormalizedImageMap(imageRegistry)

    console.log(`[vault] ${files.length}/${filePaths.length}개 파일 읽기 성공, ${Object.keys(imageRegistry).length}개 이미지 등록`)
    return { files, folders: folderRelPaths, imageRegistry }
  })

  // ── vault:watch-start ────────────────────────────────────────────────────────
  let watcher = null
  let watchDebounce = null

  ipcMain.handle('vault:watch-start', (_event, vaultPath) => {
    if (!vaultPath) return false
    if (watcher) { watcher.close(); watcher = null }

    try {
      watcher = fs.watch(vaultPath, { recursive: true }, (_eventType, filename) => {
        if (!filename || !filename.endsWith('.md')) return
        // Skip internal app config directory (.rembrant/) — written by the app itself
        // (e.g. personas.md saved by usePersonaVaultSaver). These are not user vault edits.
        if (filename.replace(/\\/g, '/').startsWith('.rembrant/')) return
        clearTimeout(watchDebounce)
        watchDebounce = setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('vault:changed', { vaultPath })
          }
        }, 500)
      })
      return true
    } catch (err) {
      console.warn('[vault] watch failed:', err)
      return false
    }
  })

  // ── vault:watch-stop ─────────────────────────────────────────────────────────
  ipcMain.handle('vault:watch-stop', () => {
    if (watcher) { watcher.close(); watcher = null }
    clearTimeout(watchDebounce)
    return true
  })

  // ── vault:save-file ──────────────────────────────────────────────────────────
  ipcMain.handle('vault:save-file', (_event, filePath, content) => {
    if (!filePath || typeof filePath !== 'string') throw new Error('Invalid file path')
    if (typeof content !== 'string') throw new Error('Invalid content')
    const resolved = path.resolve(filePath)
    if (currentVaultPath && !isInsideVault(currentVaultPath, resolved)) {
      throw new Error(`보안 오류: 볼트 외부 경로에 쓸 수 없습니다 (${resolved})`)
    }
    fs.mkdirSync(path.dirname(resolved), { recursive: true })
    fs.writeFileSync(resolved, content, 'utf-8')
    return { success: true, path: resolved }
  })

  // ── vault:rename-file ─────────────────────────────────────────────────────────
  ipcMain.handle('vault:rename-file', (_event, absolutePath, newFilename) => {
    if (!absolutePath || typeof absolutePath !== 'string') throw new Error('Invalid path')
    if (!newFilename || typeof newFilename !== 'string') throw new Error('Invalid filename')
    const resolved = path.resolve(absolutePath)
    if (currentVaultPath && !isInsideVault(currentVaultPath, resolved)) {
      throw new Error(`보안 오류: 볼트 외부 파일은 이름 변경할 수 없습니다 (${resolved})`)
    }
    if (!fs.existsSync(resolved)) throw new Error(`파일이 존재하지 않습니다: ${resolved}`)
    const dir = path.dirname(resolved)
    const newPath = path.join(dir, newFilename)
    fs.renameSync(resolved, newPath)
    return { success: true, newPath }
  })

  // ── vault:delete-file ─────────────────────────────────────────────────────────
  ipcMain.handle('vault:delete-file', (_event, absolutePath) => {
    if (!absolutePath || typeof absolutePath !== 'string') throw new Error('Invalid path')
    const resolved = path.resolve(absolutePath)
    if (currentVaultPath && !isInsideVault(currentVaultPath, resolved)) {
      throw new Error(`보안 오류: 볼트 외부 파일은 삭제할 수 없습니다 (${resolved})`)
    }
    if (!fs.existsSync(resolved)) throw new Error(`파일이 존재하지 않습니다: ${resolved}`)
    fs.unlinkSync(resolved)
    return { success: true }
  })

  // ── vault:read-file ───────────────────────────────────────────────────────────
  ipcMain.handle('vault:read-file', (_event, filePath) => {
    if (!filePath || typeof filePath !== 'string') return null
    const resolved = path.resolve(filePath)
    if (!fs.existsSync(resolved)) return null
    return fs.readFileSync(resolved, 'utf-8')
  })

  // ── vault:read-image ──────────────────────────────────────────────────────────
  ipcMain.handle('vault:read-image', (_event, filePath) => {
    if (!filePath || typeof filePath !== 'string') return null
    const resolved = path.resolve(filePath)
    if (currentVaultPath && !isInsideVault(currentVaultPath, resolved)) return null
    if (!fs.existsSync(resolved)) return null
    return readImageAsDataUrl(resolved)
  })

  // ── vault:find-image-by-name ──────────────────────────────────────────────────
  // Legacy fallback IPC (kept for compatibility). Uses the shared resolveImagePath helper.
  ipcMain.handle('vault:find-image-by-name', (_event, filename) => {
    if (!filename || typeof filename !== 'string') return null
    const normName = filename.toLowerCase().replace(/\s+/g, '_')
    const absPath = resolveImagePath(normName)
    if (!absPath) return null
    return readImageAsDataUrl(absPath)
  })

  // ── vault:create-folder ───────────────────────────────────────────────────────
  ipcMain.handle('vault:create-folder', (_event, folderPath) => {
    if (!folderPath || typeof folderPath !== 'string') throw new Error('Invalid folder path')
    const resolved = path.resolve(folderPath)
    if (currentVaultPath && !isInsideVault(currentVaultPath, resolved)) {
      throw new Error(`보안 오류: 볼트 외부에 폴더를 만들 수 없습니다 (${resolved})`)
    }
    fs.mkdirSync(resolved, { recursive: true })
    return { success: true, path: resolved }
  })

  // ── vault:move-file ───────────────────────────────────────────────────────────
  ipcMain.handle('vault:move-file', (_event, absolutePath, destFolderPath) => {
    if (!absolutePath || typeof absolutePath !== 'string') throw new Error('Invalid file path')
    if (!destFolderPath || typeof destFolderPath !== 'string') throw new Error('Invalid destination folder')
    const resolvedSrc = path.resolve(absolutePath)
    const resolvedDest = path.resolve(destFolderPath)
    if (currentVaultPath && !isInsideVault(currentVaultPath, resolvedSrc)) {
      throw new Error(`보안 오류: 볼트 외부 파일은 이동할 수 없습니다 (${resolvedSrc})`)
    }
    if (currentVaultPath) {
      const isVaultRoot = resolvedDest === path.resolve(currentVaultPath)
      if (!isVaultRoot && !isInsideVault(currentVaultPath, resolvedDest)) {
        throw new Error(`보안 오류: 볼트 외부로 파일을 이동할 수 없습니다 (${resolvedDest})`)
      }
    }
    if (!fs.existsSync(resolvedSrc)) throw new Error(`파일이 존재하지 않습니다: ${resolvedSrc}`)
    fs.mkdirSync(resolvedDest, { recursive: true })
    const filename = path.basename(resolvedSrc)
    const newPath = path.join(resolvedDest, filename)
    if (resolvedSrc !== newPath) fs.renameSync(resolvedSrc, newPath)
    return { success: true, newPath }
  })
}

function registerBackendIpcHandlers() {
  ipcMain.handle('backend:getStatus', () => ({
    ready: backendReady,
    port: BACKEND_PORT,
  }))

  ipcMain.handle('backend:isReady', () => backendReady)
}

// ── Window control IPC handlers (Fix 0) ───────────────────────────────────────

function registerWindowIpcHandlers() {
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  ipcMain.handle('window:close', () => mainWindow?.close())
  ipcMain.handle('window:toggle-devtools', () => {
    mainWindow?.webContents.toggleDevTools()
  })
}

// ── Window creation ────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1200,
    minHeight: 700,
    title: 'REMBRANDT MAP',
    icon: path.join(__dirname, '..', 'public', 'ico2.png'),
    frame: false,            // Remove native OS title bar (custom TopBar handles controls)
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
    autoHideMenuBar: true,
    backgroundColor: '#191919',
  })

  // ── Security: Handle CORS for allowed API domains ──
  // Strip Origin header so Chromium does not enforce CORS preflight at all.
  const apiUrlPatterns = ALLOWED_API_DOMAINS.map(d => `https://${d}/*`)
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: apiUrlPatterns },
    (details, callback) => {
      delete details.requestHeaders['Origin']
      delete details.requestHeaders['Referer']
      callback({ requestHeaders: details.requestHeaders })
    }
  )

  // Also inject permissive CORS response headers as a fallback.
  // For OPTIONS preflight: return 204 so the browser accepts the CORS check
  // (some API servers return 4xx for OPTIONS, which fails the preflight).
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const url = new URL(details.url)
    const isAllowed = ALLOWED_API_DOMAINS.some(
      d => url.hostname === d || url.hostname.endsWith('.' + d)
    )
    if (isAllowed) {
      const responseHeaders = {
        ...details.responseHeaders,
        'access-control-allow-origin': ['*'],
        'access-control-allow-headers': ['*'],
        'access-control-allow-methods': ['GET, POST, PUT, DELETE, OPTIONS'],
      }
      if (details.method === 'OPTIONS') {
        callback({ responseHeaders, statusLine: 'HTTP/1.1 204 No Content' })
      } else {
        callback({ responseHeaders })
      }
    } else {
      callback({ responseHeaders: details.responseHeaders })
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url)
    return { action: 'deny' }
  })
}

// ── Single instance lock ───────────────────────────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    // ── rembrandt-img:// protocol — serve vault images directly from disk ──────
    // This replaces the data-URL/IPC approach: no base64 encoding, no size limits,
    // no MIME guessing in the renderer. The browser loads images natively.
    protocol.handle('rembrandt-img', async (request) => {
      try {
        const url = new URL(request.url)
        // URL: rembrandt-img:///image-2025-6-30_12-13-7.png
        // pathname = '/image-2025-6-30_12-13-7.png'
        const normalizedName = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
        if (!normalizedName) return new Response(null, { status: 400 })

        const absPath = resolveImagePath(normalizedName)
        if (!absPath) {
          console.warn('[rembrandt-img] not found:', normalizedName)
          return new Response(null, { status: 404 })
        }

        // Use async read to avoid blocking the main process for large images
        let buffer
        try { buffer = await fs.promises.readFile(absPath) } catch {
          return new Response(null, { status: 500 })
        }

        const mime = detectMime(buffer, absPath) ?? 'application/octet-stream'
        return new Response(new Uint8Array(buffer), {
          status: 200,
          headers: {
            'Content-Type': mime,
            'Cache-Control': 'public, max-age=3600',
          },
        })
      } catch (err) {
        console.error('[rembrandt-img] handler error:', err)
        return new Response(null, { status: 500 })
      }
    })

    registerVaultIpcHandlers()
    registerBackendIpcHandlers()
    registerWindowIpcHandlers()
    startPythonBackend()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    stopPythonBackend()
  })
}
