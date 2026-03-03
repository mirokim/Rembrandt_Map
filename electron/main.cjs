const { app, BrowserWindow, shell, session, ipcMain, dialog } = require('electron')
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
 * Read an image file and return a base64 data URL.
 * Detects the actual MIME type from file magic bytes rather than relying
 * solely on the file extension — handles misnamed files (e.g. JPEG saved as .png).
 * Returns null if the file is empty, unreadable, or not a known image format.
 */
function readImageAsDataUrl(absPath) {
  let buffer
  try {
    buffer = fs.readFileSync(absPath)
  } catch (err) {
    console.warn('[vault] readImageAsDataUrl: readFileSync failed:', absPath, err.message)
    return null
  }
  if (!buffer || buffer.length === 0) {
    console.warn('[vault] readImageAsDataUrl: empty file:', absPath)
    return null
  }

  // Detect MIME from magic bytes (more reliable than file extension)
  let mime = null
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    mime = 'image/png'
  } else if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    mime = 'image/jpeg'
  } else if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    mime = 'image/gif'  // GIF87a or GIF89a
  } else if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    mime = 'image/webp'
  } else if (buffer[0] === 0x42 && buffer[1] === 0x4D) {
    mime = 'image/bmp'
  } else {
    // SVG or fallback to extension
    const head = buffer.slice(0, 64).toString('utf8')
    if (head.includes('<svg') || head.includes('<?xml')) {
      mime = 'image/svg+xml'
    } else {
      const ext = path.extname(absPath).slice(1).toLowerCase()
      const byExt = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
                      gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp' }
      mime = byExt[ext] ?? null
    }
  }

  if (!mime) {
    console.warn('[vault] readImageAsDataUrl: unrecognized format:', absPath)
    return null
  }
  return `data:${mime};base64,${buffer.toString('base64')}`
}

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
    // file systems.  Instead of relying on stat, we determine file type by
    // extension (.md → file) and try readdirSync to detect directories.

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

    // 3) Skip other non-directory files (have a file extension)
    if (/\.\w{1,10}$/.test(entry.name)) continue

    // 4) Remaining entries (no extension) — try to recurse as directory.
    //    readdirSync will throw if it's not a readable directory → caught below.
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
  // 레지스트리에 없는 경우를 위한 폴백: basename으로 볼트 전체를 직접 탐색
  // collectVaultContents 대신 독립적인 탐색 구현 (isDirectory 기반)
  ipcMain.handle('vault:find-image-by-name', (_event, filename) => {
    if (!filename || typeof filename !== 'string') return null
    if (!currentVaultPath) return null

    // normalize: lowercase + spaces → underscores (matches graphBuilder imageId convention)
    const normTarget = filename.toLowerCase().replace(/\s+/g, '_')
    function normName(n) { return n.toLowerCase().replace(/\s+/g, '_') }

    // ── Fast path: existsSync in common Obsidian attachment folders ──
    // Windows existsSync is case-insensitive, so this works regardless of
    // the actual case of the stored filename.
    const COMMON = ['attachments', 'Attachments', 'assets', 'images', 'img', 'media', 'files']
    for (const folder of COMMON) {
      const candidate = path.join(currentVaultPath, folder, filename)
      if (fs.existsSync(candidate)) {
        const result = readImageAsDataUrl(candidate)
        if (result) { console.log('[vault] find-image fast-path:', candidate); return result }
      }
    }
    // Also try vault root directly
    const rootCandidate = path.join(currentVaultPath, filename)
    if (fs.existsSync(rootCandidate)) {
      const result = readImageAsDataUrl(rootCandidate)
      if (result) { console.log('[vault] find-image fast-path (root):', rootCandidate); return result }
    }

    // ── Slow path: recursive search using isDirectory() ──
    function searchDir(dirPath, depth) {
      if (depth > 8) return null
      let entries
      try { entries = fs.readdirSync(dirPath, { withFileTypes: true }) } catch { return null }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const fullPath = path.join(dirPath, entry.name)
        // Name match (normalized comparison handles spaces vs underscores)
        if (normName(entry.name) === normTarget) return fullPath
        // Recurse into directories
        let isDir = false
        try { isDir = entry.isDirectory() } catch { /* ignore */ }
        if (!isDir && !/\.\w{1,10}$/.test(entry.name)) {
          // No extension + isDirectory() failed → try readdirSync as directory detection
          try { fs.readdirSync(fullPath); isDir = true } catch { /* not a dir */ }
        }
        if (isDir) {
          const result = searchDir(fullPath, depth + 1)
          if (result) return result
        }
      }
      return null
    }

    const found = searchDir(currentVaultPath, 0)
    if (!found) {
      console.warn('[vault] find-image-by-name: not found →', filename)
      return null
    }
    console.log('[vault] find-image slow-path:', found)
    return readImageAsDataUrl(found)
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
