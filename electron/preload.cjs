const { contextBridge, ipcRenderer } = require('electron')

// ── electronAPI ────────────────────────────────────────────────────────────────
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
})

// ── windowAPI (Fix 0) — frameless window controls ─────────────────────────────
contextBridge.exposeInMainWorld('windowAPI', {
  minimize:       () => ipcRenderer.invoke('window:minimize'),
  maximize:       () => ipcRenderer.invoke('window:maximize'),
  close:          () => ipcRenderer.invoke('window:close'),
  toggleDevTools: () => ipcRenderer.invoke('window:toggle-devtools'),
})

// ── vaultAPI (Phase 6) ────────────────────────────────────────────────────────
contextBridge.exposeInMainWorld('vaultAPI', {
  /** Open a folder picker dialog; returns the selected path or null */
  selectFolder: () => ipcRenderer.invoke('vault:select-folder'),

  /** Load all .md files from the given absolute vault path */
  loadFiles: (dirPath) => ipcRenderer.invoke('vault:load-files', dirPath),

  /** Start watching the vault directory for changes (debounced 500ms) */
  watchStart: (dirPath) => ipcRenderer.invoke('vault:watch-start', dirPath),

  /** Stop the active file watcher */
  watchStop: () => ipcRenderer.invoke('vault:watch-stop'),

  /** Save a file to the filesystem (used by MD converter and editor) */
  saveFile: (filePath, content) => ipcRenderer.invoke('vault:save-file', filePath, content),

  /** Rename a file — newFilename is just the filename (no path) */
  renameFile: (absolutePath, newFilename) =>
    ipcRenderer.invoke('vault:rename-file', absolutePath, newFilename),

  /** Permanently delete a file */
  deleteFile: (absolutePath) => ipcRenderer.invoke('vault:delete-file', absolutePath),

  /** Read a single file by absolute path; returns null if not found */
  readFile: (filePath) => ipcRenderer.invoke('vault:read-file', filePath),

  /** Read an image file as base64 data URL; returns null if not found or outside vault */
  readImage: (filePath) => ipcRenderer.invoke('vault:read-image', filePath),

  /** Fallback: find an image anywhere in the vault by its filename (basename search) */
  findImageByName: (filename) => ipcRenderer.invoke('vault:find-image-by-name', filename),

  /** Create a directory (and any missing parents) inside the vault */
  createFolder: (folderPath) => ipcRenderer.invoke('vault:create-folder', folderPath),

  /** Move a file to a different folder inside the vault */
  moveFile: (absolutePath, destFolderPath) =>
    ipcRenderer.invoke('vault:move-file', absolutePath, destFolderPath),

  /**
   * Subscribe to vault file-change events.
   * Returns a cleanup function that removes the listener.
   */
  onChanged: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('vault:changed', listener)
    return () => ipcRenderer.removeListener('vault:changed', listener)
  },
})

// ── confluenceAPI ─────────────────────────────────────────────────────────────
contextBridge.exposeInMainWorld('confluenceAPI', {
  /** Fetch all pages from a Confluence space. Returns raw page objects. */
  fetchPages: (config) => ipcRenderer.invoke('confluence:fetch-pages', config),

  /** Save converted markdown files to the vault. */
  savePages: (vaultPath, targetFolder, pagesWithMd) =>
    ipcRenderer.invoke('confluence:save-pages', vaultPath, targetFolder, pagesWithMd),

  /** Download image attachments for a single page. */
  downloadAttachments: (config, vaultPath, targetFolder, pageId) =>
    ipcRenderer.invoke('confluence:download-attachments', config, vaultPath, targetFolder, pageId),

  /** Run a Python script from manual/scripts/. Returns { stdout, stderr, exitCode }. */
  runScript: (scriptName, args) =>
    ipcRenderer.invoke('tools:run-script', scriptName, args),

  /** Delete saved files and remove empty dirs. Returns { deleted, errors }. */
  rollback: (files, dirs) =>
    ipcRenderer.invoke('confluence:rollback', files, dirs),

  /** Read a file from the app directory (e.g. 'manual/foo.md'). Returns text or null. */
  readAppFile: (relativePath) =>
    ipcRenderer.invoke('tools:read-app-file', relativePath),
})

// ── backendAPI (Phase 1-3) ────────────────────────────────────────────────────
const BACKEND_BASE = 'http://127.0.0.1:8765'

async function backendFetch(urlPath, options) {
  const res = await fetch(`${BACKEND_BASE}${urlPath}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => String(res.status))
    throw new Error(`Backend ${res.status}: ${text}`)
  }
  return res.json()
}

contextBridge.exposeInMainWorld('backendAPI', {
  /** Get backend readiness status */
  getStatus: () => ipcRenderer.invoke('backend:getStatus'),

  /** Index document chunks into ChromaDB */
  indexDocuments: (chunks) =>
    backendFetch('/docs/index', {
      method: 'POST',
      body: JSON.stringify({ documents: chunks }),
    }),

  /** Clear the entire vector index */
  clearIndex: () => backendFetch('/docs/clear', { method: 'DELETE' }),

  /** Semantic search — returns top-k matching chunks */
  search: (query, topK) =>
    backendFetch('/docs/search', {
      method: 'POST',
      body: JSON.stringify({ query, top_k: topK !== undefined ? topK : 3 }),
    }),

  /** Get collection stats (chunk count) */
  getStats: () => backendFetch('/docs/stats'),

  /**
   * Subscribe to backend:ready IPC event.
   * Returns a cleanup function.
   */
  onReady: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('backend:ready', listener)
    return () => ipcRenderer.removeListener('backend:ready', listener)
  },
})

// ── ragAPI (Slack RAG bridge) ─────────────────────────────────────────────────
contextBridge.exposeInMainWorld('ragAPI', {
  /** Listen for search requests from the HTTP server (via main process). */
  onSearch: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('rag:search', listener)
    return () => ipcRenderer.removeListener('rag:search', listener)
  },
  /** Listen for settings requests from the HTTP server (via main process). */
  onGetSettings: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('rag:get-settings', listener)
    return () => ipcRenderer.removeListener('rag:get-settings', listener)
  },
  /** Send results/settings back to the HTTP server (via main process). */
  sendResult: (requestId, results) => {
    ipcRenderer.send('rag:result', { requestId, results })
  },
})
