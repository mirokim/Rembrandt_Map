import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppState, CenterTab, ThemeId, GraphMode } from '@/types'

interface UIState {
  appState: AppState
  centerTab: CenterTab
  selectedDocId: string | null
  theme: ThemeId
  graphMode: GraphMode
  panelOpacity: number

  setAppState: (s: AppState) => void
  setCenterTab: (t: CenterTab) => void
  setSelectedDoc: (id: string | null) => void
  setTheme: (t: ThemeId) => void
  setGraphMode: (m: GraphMode) => void
  setPanelOpacity: (o: number) => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      appState: 'launch',
      centerTab: 'graph',
      selectedDocId: null,
      theme: 'dark',
      graphMode: '3d',
      panelOpacity: 1,

      setAppState: (appState) => set({ appState }),
      setCenterTab: (centerTab) => set({ centerTab }),
      setSelectedDoc: (selectedDocId) => set({ selectedDocId }),
      setTheme: (theme) => set({ theme }),
      setGraphMode: (graphMode) => set({ graphMode }),
      setPanelOpacity: (panelOpacity) => set({ panelOpacity }),
    }),
    {
      name: 'rembrandt-ui',
      partialize: (state) => ({
        theme: state.theme,
        // graphMode is NOT persisted — app always starts in 3D (user intent)
        panelOpacity: state.panelOpacity,
      }),
    }
  )
)
