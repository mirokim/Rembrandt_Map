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
