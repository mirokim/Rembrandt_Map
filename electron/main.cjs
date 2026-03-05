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

// ── App asset reader (safe: confined to app directory) ─────────────────────────

ipcMain.handle('tools:read-app-file', (_event, relativePath) => {
  if (!relativePath || typeof relativePath !== 'string') return null
  // Reject absolute paths and traversal sequences
  if (path.isAbsolute(relativePath) || relativePath.includes('..')) return null
  const appRoot = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..')
  const filePath = path.resolve(path.join(appRoot, relativePath))
  if (!filePath.startsWith(path.resolve(appRoot))) return null
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath, 'utf-8')
})

// ── Confluence IPC handlers ────────────────────────────────────────────────────

function registerConfluenceIpcHandlers() {
  /**
   * Fetch all pages from a Confluence space via REST API v1.
   * Uses Electron's net.fetch to bypass CORS.
   * Returns raw page objects: { id, title, body.storage.value, metadata.labels, version, history }
   */
  /**
   * Returns the REST API base path for a Confluence instance.
   * Atlassian Cloud uses /wiki/rest/api; Server/Data Center uses /rest/api.
   */
  function getRestApiBase(baseUrl) {
    try {
      const host = new URL(baseUrl).hostname
      return host.endsWith('atlassian.net') ? `${baseUrl}/wiki/rest/api` : `${baseUrl}/rest/api`
    } catch {
      return `${baseUrl}/rest/api`
    }
  }

  /**
   * Build Authorization header based on auth type.
   * cloud / server_basic → Basic base64(email:token)
   * server_pat           → Bearer <token>
   */
  function buildConfluenceAuthHeaders(authType, email, apiToken) {
    let authHeader
    if (authType === 'server_pat') {
      authHeader = `Bearer ${apiToken}`
    } else {
      authHeader = `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`
    }
    return { Authorization: authHeader, Accept: 'application/json' }
  }

  /**
   * Apply SSL bypass for the duration of a callback (corporate self-signed certs).
   * Restores the original verify proc afterward.
   */
  async function withSSLBypass(bypass, fn) {
    if (!bypass) return fn()
    const { session } = require('electron')
    session.defaultSession.setCertificateVerifyProc((_req, cb) => cb(0))
    try {
      return await fn()
    } finally {
      session.defaultSession.setCertificateVerifyProc(null)  // restore default
    }
  }

  ipcMain.handle('confluence:fetch-pages', async (_event, config) => {
    const { baseUrl, authType = 'cloud', email, apiToken, spaceKey, dateFrom, dateTo, bypassSSL = false } = config

    // Validate required fields (server_pat doesn't need email)
    if (!baseUrl || !apiToken || !spaceKey) {
      throw new Error('baseUrl, apiToken, spaceKey 는 필수 항목입니다.')
    }
    if (authType !== 'server_pat' && !email) {
      throw new Error('Cloud / Server Basic 인증은 이메일(사용자명)이 필요합니다.')
    }

    // Date range validation — hard lower bound: 2025-01-01
    const HARD_MIN = '2025-01-01'
    const effectiveDateFrom = (!dateFrom || dateFrom < HARD_MIN) ? HARD_MIN : dateFrom
    if (dateFrom && dateFrom < HARD_MIN) {
      console.warn(`[Confluence] dateFrom(${dateFrom}) < 최소 허용값(${HARD_MIN}), ${HARD_MIN}로 보정합니다.`)
    }

    const base = baseUrl.replace(/\/+$/, '')
    const headers = buildConfluenceAuthHeaders(authType, email, apiToken)
    const restBase = getRestApiBase(base)

    // Build CQL query for server-side date filtering (much more reliable than client-side)
    // lastModified covers both created and modified dates on all Confluence versions
    let cql = `space = "${spaceKey}" AND type = page AND lastModified >= "${effectiveDateFrom}"`
    if (dateTo) cql += ` AND lastModified <= "${dateTo}"`
    cql += ` ORDER BY lastModified DESC`

    const pages = []
    let start = 0
    const limit = 50

    while (true) {
      const url =
        `${restBase}/content/search` +
        `?cql=${encodeURIComponent(cql)}` +
        `&expand=body.storage,metadata.labels,version,history` +
        `&limit=${limit}` +
        `&start=${start}`

      let res
      try {
        res = await withSSLBypass(bypassSSL, () => net.fetch(url, { headers }))
      } catch (fetchErr) {
        const msg = fetchErr?.message ?? String(fetchErr)
        if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('ETIMEDOUT')) {
          throw new Error(`서버에 연결할 수 없습니다. VPN 연결 상태 및 Base URL을 확인하세요.\n(${msg})`)
        }
        if (msg.includes('certificate') || msg.includes('CERT') || msg.includes('SSL')) {
          throw new Error(`SSL 인증서 오류입니다. 사내 CA 인증서 사용 시 "SSL 인증서 우회" 옵션을 활성화하세요.\n(${msg})`)
        }
        throw fetchErr
      }
      if (!res.ok) {
        const errText = await res.text().catch(() => String(res.status))
        if (res.status === 401) {
          const hint = authType === 'server_pat'
            ? 'PAT 토큰이 올바른지 확인하세요.'
            : 'API 토큰 또는 이메일/사용자명을 확인하세요.'
          throw new Error(`인증 실패 (401). ${hint}`)
        }
        if (res.status === 403) throw new Error(`접근 거부 (403). 해당 스페이스에 대한 읽기 권한이 없습니다.`)
        if (res.status === 404) throw new Error(`스페이스 또는 검색 API를 찾을 수 없습니다 (404). Space Key와 Base URL을 확인하세요.`)
        throw new Error(`Confluence API ${res.status}: ${errText.slice(0, 300)}`)
      }
      const data = await res.json()

      for (const page of (data.results ?? [])) {
        pages.push(page)
      }

      // CQL search returns totalSize; stop when we have all results
      const totalSize = data.totalSize ?? data.size ?? 0
      if (pages.length >= totalSize || (data.results ?? []).length < limit) break
      start += limit
    }

    return pages
  })

  /**
   * Write converted markdown files into the vault.
   * pagesWithMd: Array<{ filename: string; content: string }>
   */
  ipcMain.handle('confluence:save-pages', async (_event, vaultPath, targetFolder, pagesWithMd) => {
    if (!vaultPath || typeof vaultPath !== 'string') throw new Error('Invalid vault path')
    const resolvedVault = path.resolve(vaultPath)

    // Validate targetFolder — block absolute paths and traversal, allow nested relative paths
    if (!targetFolder || typeof targetFolder !== 'string') throw new Error('Invalid target folder')
    if (path.isAbsolute(targetFolder) || targetFolder.includes('..')) throw new Error('Invalid target folder')
    const targetDir = path.resolve(path.join(resolvedVault, targetFolder))
    if (!isInsideVault(resolvedVault, targetDir)) throw new Error('Target folder is outside vault')

    fs.mkdirSync(targetDir, { recursive: true })
    let saved = 0
    const savedFiles = []
    for (const { filename, content } of pagesWithMd) {
      if (!filename || typeof content !== 'string') continue
      // Sanitize to plain basename — no path traversal
      const safeFilename = path.basename(filename)
      const filePath = path.join(targetDir, safeFilename)
      if (!isInsideVault(resolvedVault, filePath)) continue
      fs.writeFileSync(filePath, content, 'utf-8')
      savedFiles.push(filePath)
      saved++
    }
    // targetDir IS the active dir (per manual: vault/active/ = targetFolder)
    return { saved, targetDir, activeDir: targetDir, files: savedFiles }
  })

  /**
   * Rollback: delete the given file paths and remove empty directories.
   * Returns { deleted, errors } — errors are non-fatal (file locked / already gone).
   */
  ipcMain.handle('confluence:rollback', async (_event, files, dirs) => {
    if (!currentVaultPath) throw new Error('볼트가 열려있지 않습니다')
    const resolvedVault = path.resolve(currentVaultPath)
    let deleted = 0
    const errors = []

    for (const f of (files ?? [])) {
      const resolved = path.resolve(f)
      if (!isInsideVault(resolvedVault, resolved)) {
        errors.push(`보안: 볼트 외부 경로 거부됨 — ${path.basename(f)}`)
        continue
      }
      try {
        if (fs.existsSync(resolved)) { fs.unlinkSync(resolved); deleted++ }
      } catch (e) {
        errors.push(`${path.basename(f)}: ${e.message}`)
      }
    }

    // Remove directories only if now empty
    for (const d of (dirs ?? [])) {
      const resolved = path.resolve(d)
      if (!isInsideVault(resolvedVault, resolved)) {
        errors.push(`보안: 볼트 외부 폴더 거부됨 — ${path.basename(d)}`)
        continue
      }
      try {
        if (fs.existsSync(resolved)) {
          const remaining = fs.readdirSync(resolved)
          if (remaining.length === 0) fs.rmdirSync(resolved)
          else errors.push(`폴더 비어있지 않음 (${remaining.length}개): ${path.basename(d)}`)
        }
      } catch (e) {
        errors.push(`폴더 삭제 실패 (${path.basename(d)}): ${e.message}`)
      }
    }

    return { deleted, errors }
  })

  /**
   * Download Confluence image attachments for a page and save to attachments folder.
   * Returns array of { filename, savedPath }.
   */
  ipcMain.handle('confluence:download-attachments', async (_event, config, vaultPath, targetFolder, pageId) => {
    const { baseUrl, authType = 'cloud', email, apiToken, bypassSSL = false } = config
    const base = baseUrl.replace(/\/+$/, '')
    const headers = buildConfluenceAuthHeaders(authType, email, apiToken)
    const restBase = getRestApiBase(base)

    // Fetch attachment list
    const listUrl = `${restBase}/content/${pageId}/child/attachment?expand=version&limit=50&mediaType=image`
    const res = await net.fetch(listUrl, { headers })
    if (!res.ok) return []
    const data = await res.json()
    const attachments = data.results ?? []

    const resolvedVault = path.resolve(vaultPath)
    // Images go to vault root attachments/ (per Graph RAG manual: vault/attachments/)
    const attDir = path.join(resolvedVault, 'attachments')
    if (!isInsideVault(resolvedVault, attDir)) throw new Error('Attachments dir is outside vault')
    fs.mkdirSync(attDir, { recursive: true })

    const savedFilePaths = []
    for (const att of attachments) {
      // Use path.basename to strip any traversal in server-supplied filename
      const rawName = att.title ?? att.metadata?.mediaType ?? 'attachment'
      const filename = path.basename(rawName) || 'attachment'
      const downloadUrl = att._links?.download
        ? `${base}${att._links.download}`
        : `${base}/wiki/download/attachments/${pageId}/${encodeURIComponent(filename)}`
      try {
        const imgRes = await withSSLBypass(bypassSSL, () => net.fetch(downloadUrl, { headers }))
        if (!imgRes.ok) continue
        const buf = Buffer.from(await imgRes.arrayBuffer())
        const savedPath = path.join(attDir, filename)
        if (!isInsideVault(resolvedVault, savedPath)) continue
        fs.writeFileSync(savedPath, buf)
        savedFilePaths.push(savedPath)
      } catch { /* skip failed images */ }
    }
    return { downloaded: savedFilePaths.length, files: savedFilePaths }
  })

  /**
   * Run a Python script from manual/scripts/ with given args.
   * Returns { stdout, stderr, exitCode }.
   */
  ipcMain.handle('tools:run-script', async (_event, scriptName, args) => {
    // Reject any scriptName containing path separators or traversal
    if (!scriptName || typeof scriptName !== 'string' ||
        scriptName.includes('/') || scriptName.includes('\\') || scriptName.includes('..')) {
      throw new Error(`Invalid script name: ${scriptName}`)
    }

    const appDir = app.isPackaged
      ? path.join(process.resourcesPath, 'manual', 'scripts')
      : path.join(__dirname, '..', 'manual', 'scripts')
    const scriptPath = path.resolve(path.join(appDir, scriptName))
    // Verify resolved path is still inside appDir
    if (!scriptPath.startsWith(path.resolve(appDir))) {
      throw new Error(`Script path escapes scripts directory`)
    }
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`스크립트를 찾을 수 없습니다: ${scriptPath}`)
    }

    return new Promise((resolve) => {
      const pyCmd = process.platform === 'win32' ? 'python' : 'python3'
      const proc = spawn(pyCmd, [scriptPath, ...(args ?? [])], {
        cwd: app.isPackaged ? process.resourcesPath : path.join(__dirname, '..'),
        env: { ...process.env },
      })
      let stdout = ''
      let stderr = ''
      proc.stdout.on('data', d => { stdout += d.toString() })
      proc.stderr.on('data', d => { stderr += d.toString() })
      let timer = null
      proc.on('close', exitCode => { if (timer) clearTimeout(timer); resolve({ stdout, stderr, exitCode }) })
      proc.on('error', err => { if (timer) clearTimeout(timer); resolve({ stdout: '', stderr: err.message, exitCode: -1 }) })
      // Safety timeout: 60s max per script
      timer = setTimeout(() => { proc.kill(); resolve({ stdout, stderr: stderr + '\n[TIMEOUT]', exitCode: -1 }) }, 60000)
    })
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

// ── RAG API HTTP server (Slack bot bridge) ─────────────────────────────────────
const RAG_API_PORT = 7331
const _ragResolvers = new Map()

function startRagApiServer() {
  const http = require('http')

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${RAG_API_PORT}`)
    if (url.pathname !== '/search') {
      res.writeHead(404)
      res.end('{"error":"not found"}')
      return
    }

    const query = url.searchParams.get('q') || ''
    const topN  = Math.min(parseInt(url.searchParams.get('n') || '5'), 20)

    if (!query.trim()) {
      res.writeHead(400)
      res.end('{"error":"query required"}')
      return
    }

    const requestId = `${Date.now()}-${Math.random()}`
    const timer = setTimeout(() => {
      _ragResolvers.delete(requestId)
      res.writeHead(504)
      res.end('{"error":"timeout"}')
    }, 15000)

    _ragResolvers.set(requestId, (results) => {
      clearTimeout(timer)
      _ragResolvers.delete(requestId)
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(results))
    })

    if (mainWindow) {
      mainWindow.webContents.send('rag:search', { requestId, query, topN })
    } else {
      clearTimeout(timer)
      _ragResolvers.delete(requestId)
      res.writeHead(503)
      res.end('{"error":"window not ready"}')
    }
  })

  ipcMain.on('rag:result', (_event, { requestId, results }) => {
    const resolve = _ragResolvers.get(requestId)
    if (resolve) resolve(results)
  })

  server.listen(RAG_API_PORT, '127.0.0.1', () => {
    console.log(`[RAG API] http://127.0.0.1:${RAG_API_PORT}`)
  })
}

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
    registerConfluenceIpcHandlers()
    startPythonBackend()
    createWindow()
    startRagApiServer()

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
