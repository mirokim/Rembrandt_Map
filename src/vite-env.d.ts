/// <reference types="vite/client" />

import type { VaultFile, BackendChunk, SearchResult } from '@/types'

declare global {
  interface Window {
    electronAPI?: {
      isElectron: boolean
      platform: string
    }

    // ── windowAPI (Fix 0) — frameless window controls ─────────────────────────
    windowAPI?: {
      minimize(): Promise<void>
      maximize(): Promise<void>
      close(): Promise<void>
      toggleDevTools(): Promise<void>
    }

    // ── vaultAPI (Phase 6) ────────────────────────────────────────────────────
    vaultAPI?: {
      selectFolder(): Promise<string | null>
      loadFiles(dirPath: string): Promise<VaultFile[]>
      watchStart(dirPath: string): Promise<boolean>
      watchStop(): Promise<boolean>
      onChanged(callback: (data: { vaultPath: string }) => void): () => void
      saveFile(filePath: string, content: string): Promise<{ success: boolean; path: string }>
      renameFile(absolutePath: string, newFilename: string): Promise<{ success: boolean; newPath: string }>
      deleteFile(absolutePath: string): Promise<{ success: boolean }>
    }

    // ── backendAPI (Phase 1-3) ────────────────────────────────────────────────
    backendAPI?: {
      getStatus(): Promise<{ ready: boolean; port: number }>
      indexDocuments(chunks: BackendChunk[]): Promise<{ indexed: number }>
      clearIndex(): Promise<{ cleared: boolean }>
      search(query: string, topK?: number): Promise<{ results: SearchResult[]; query: string }>
      getStats(): Promise<{ doc_count: number; chunk_count: number; collection_name: string }>
      onReady(callback: (data: { port: number }) => void): () => void
    }
  }
}

export {}
