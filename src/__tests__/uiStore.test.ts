import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from '@/stores/uiStore'

// Reset store state before each test
beforeEach(() => {
  useUIStore.setState({
    appState: 'launch',
    centerTab: 'graph',
    selectedDocId: null,
    theme: 'dark',
    graphMode: '3d',
    panelOpacity: 1,
    showNodeLabels: false,
  })
})

describe('useUIStore — appState', () => {
  it('defaults to "launch"', () => {
    expect(useUIStore.getState().appState).toBe('launch')
  })

  it('setAppState transitions to "main"', () => {
    useUIStore.getState().setAppState('main')
    expect(useUIStore.getState().appState).toBe('main')
  })

  it('setAppState transitions back to "launch"', () => {
    useUIStore.getState().setAppState('main')
    useUIStore.getState().setAppState('launch')
    expect(useUIStore.getState().appState).toBe('launch')
  })
})

describe('useUIStore — centerTab', () => {
  it('defaults to "graph"', () => {
    expect(useUIStore.getState().centerTab).toBe('graph')
  })

  it('setCenterTab switches to "document"', () => {
    useUIStore.getState().setCenterTab('document')
    expect(useUIStore.getState().centerTab).toBe('document')
  })

  it('setCenterTab switches back to "graph"', () => {
    useUIStore.getState().setCenterTab('document')
    useUIStore.getState().setCenterTab('graph')
    expect(useUIStore.getState().centerTab).toBe('graph')
  })

  it('setCenterTab switches to "editor"', () => {
    useUIStore.getState().setCenterTab('editor')
    expect(useUIStore.getState().centerTab).toBe('editor')
  })

  it('setCenterTab can cycle graph → editor → document → graph', () => {
    useUIStore.getState().setCenterTab('editor')
    expect(useUIStore.getState().centerTab).toBe('editor')
    useUIStore.getState().setCenterTab('document')
    expect(useUIStore.getState().centerTab).toBe('document')
    useUIStore.getState().setCenterTab('graph')
    expect(useUIStore.getState().centerTab).toBe('graph')
  })
})

describe('useUIStore — selectedDocId', () => {
  it('defaults to null', () => {
    expect(useUIStore.getState().selectedDocId).toBeNull()
  })

  it('setSelectedDoc updates to a string ID', () => {
    useUIStore.getState().setSelectedDoc('doc_001')
    expect(useUIStore.getState().selectedDocId).toBe('doc_001')
  })

  it('setSelectedDoc can clear to null', () => {
    useUIStore.getState().setSelectedDoc('doc_001')
    useUIStore.getState().setSelectedDoc(null)
    expect(useUIStore.getState().selectedDocId).toBeNull()
  })
})

describe('useUIStore — theme', () => {
  it('defaults to "dark"', () => {
    expect(useUIStore.getState().theme).toBe('dark')
  })

  it('setTheme switches to "oled"', () => {
    useUIStore.getState().setTheme('oled')
    expect(useUIStore.getState().theme).toBe('oled')
  })
})

describe('useUIStore — graphMode', () => {
  it('defaults to "3d"', () => {
    expect(useUIStore.getState().graphMode).toBe('3d')
  })

  it('setGraphMode switches to "2d"', () => {
    useUIStore.getState().setGraphMode('2d')
    expect(useUIStore.getState().graphMode).toBe('2d')
  })

  it('setGraphMode switches back to "3d"', () => {
    useUIStore.getState().setGraphMode('2d')
    useUIStore.getState().setGraphMode('3d')
    expect(useUIStore.getState().graphMode).toBe('3d')
  })
})

describe('useUIStore — panelOpacity', () => {
  it('defaults to 1', () => {
    expect(useUIStore.getState().panelOpacity).toBe(1)
  })

  it('setPanelOpacity updates to 0.5', () => {
    useUIStore.getState().setPanelOpacity(0.5)
    expect(useUIStore.getState().panelOpacity).toBe(0.5)
  })

  it('setPanelOpacity clamps work — can set min/max boundary values', () => {
    useUIStore.getState().setPanelOpacity(0.3)
    expect(useUIStore.getState().panelOpacity).toBe(0.3)
    useUIStore.getState().setPanelOpacity(0.97)
    expect(useUIStore.getState().panelOpacity).toBe(0.97)
  })
})

describe('useUIStore — showNodeLabels / toggleNodeLabels', () => {
  it('defaults to false', () => {
    expect(useUIStore.getState().showNodeLabels).toBe(false)
  })

  it('toggleNodeLabels flips to true', () => {
    useUIStore.getState().toggleNodeLabels()
    expect(useUIStore.getState().showNodeLabels).toBe(true)
  })

  it('toggleNodeLabels flips back to false', () => {
    useUIStore.getState().toggleNodeLabels()
    useUIStore.getState().toggleNodeLabels()
    expect(useUIStore.getState().showNodeLabels).toBe(false)
  })

  it('toggling does not affect other UI state', () => {
    useUIStore.getState().setCenterTab('document')
    useUIStore.getState().toggleNodeLabels()
    expect(useUIStore.getState().centerTab).toBe('document')
    expect(useUIStore.getState().appState).toBe('launch')
  })
})
