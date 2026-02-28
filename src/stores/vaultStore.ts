/**
 * vaultStore.ts — Phase 6
 *
 * Stores the user's selected vault path and parsed documents.
 * Only vaultPath is persisted — documents are re-loaded from the filesystem
 * on each app start (so they stay fresh without a separate sync mechanism).
 *
 * Mock fallback pattern (used by FileTree, DocViewer, useDocumentFilter):
 *   const docs = (vaultPath && loadedDocuments) ? loadedDocuments : MOCK_DOCUMENTS
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LoadedDocument } from '@/types'

interface VaultState {
  /** Persisted: absolute path to the selected vault root */
  vaultPath: string | null
  /** Runtime: parsed documents (not persisted) */
  loadedDocuments: LoadedDocument[] | null
  /** Runtime: all known subfolder paths in the vault (relative to vault root) */
  vaultFolders: string[]
  /** Runtime: true while loading/parsing files */
  isLoading: boolean
  /** Runtime: last error message, null if none */
  error: string | null

  setVaultPath: (path: string | null) => void
  setLoadedDocuments: (docs: LoadedDocument[] | null) => void
  setVaultFolders: (folders: string[]) => void
  setIsLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  /** Clear vault path + documents + error */
  clearVault: () => void
}

export const useVaultStore = create<VaultState>()(
  persist(
    (set) => ({
      vaultPath: null,
      loadedDocuments: null,
      vaultFolders: [],
      isLoading: false,
      error: null,

      setVaultPath: (vaultPath) => set({ vaultPath }),
      setLoadedDocuments: (loadedDocuments) => set({ loadedDocuments }),
      setVaultFolders: (vaultFolders) => set({ vaultFolders }),
      setIsLoading: (isLoading) => set({ isLoading }),
      setError: (error) => set({ error }),
      clearVault: () =>
        set({ vaultPath: null, loadedDocuments: null, vaultFolders: [], error: null, isLoading: false }),
    }),
    {
      name: 'rembrandt-vault',
      // Only persist vaultPath — documents are re-loaded from disk on startup
      partialize: (state) => ({ vaultPath: state.vaultPath }),
    }
  )
)
