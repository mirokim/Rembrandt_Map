import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FileTree from '@/components/fileTree/FileTree'
import { useUIStore } from '@/stores/uiStore'
import { useVaultStore } from '@/stores/vaultStore'
import { MOCK_DOCUMENTS } from '@/data/mockDocuments'

beforeEach(() => {
  useUIStore.setState({
    appState: 'main',
    centerTab: 'graph',
    selectedDocId: null,
    theme: 'dark',
    graphMode: '3d',
  })
  // Reset vault store so tests always use Mock data fallback
  useVaultStore.setState({
    vaultPath: null,
    loadedDocuments: null,
    isLoading: false,
    error: null,
  })
})

describe('FileTree — rendering', () => {
  it('renders the file tree container', () => {
    render(<FileTree />)
    expect(screen.getByTestId('file-tree')).toBeInTheDocument()
  })

  it('renders all 5 speaker groups', () => {
    render(<FileTree />)
    const groups = screen.getAllByRole('button', { name: /CHIEF|ART|PLAN|LEVEL|PROG/i })
    // Each SpeakerGroup header button matches
    expect(groups.length).toBeGreaterThanOrEqual(5)
  })

  it('shows total document count in footer', () => {
    render(<FileTree />)
    expect(screen.getByText(`${MOCK_DOCUMENTS.length} / ${MOCK_DOCUMENTS.length} 문서`)).toBeInTheDocument()
  })
})

describe('FileTree — search filtering', () => {
  it('renders the search input', () => {
    render(<FileTree />)
    expect(screen.getByRole('textbox', { name: /search/i })).toBeInTheDocument()
  })

  it('filters documents by filename', async () => {
    render(<FileTree />)
    const searchInput = screen.getByRole('textbox', { name: /search/i })
    await userEvent.type(searchInput, 'character')
    // Only art docs with "character" should remain visible
    expect(screen.getByText(/0 문서|1 문서|2 문서/)).toBeInTheDocument()
  })

  it('shows "검색 결과 없음" when no match', async () => {
    render(<FileTree />)
    const searchInput = screen.getByRole('textbox', { name: /search/i })
    await userEvent.type(searchInput, 'xyznonexistent')
    expect(screen.getByText('검색 결과 없음')).toBeInTheDocument()
  })

  it('clear button resets search', async () => {
    render(<FileTree />)
    const searchInput = screen.getByRole('textbox', { name: /search/i })
    await userEvent.type(searchInput, 'character')
    const clearBtn = screen.getByRole('button', { name: /clear search/i })
    await userEvent.click(clearBtn)
    expect(searchInput).toHaveValue('')
    expect(screen.getByText(`${MOCK_DOCUMENTS.length} / ${MOCK_DOCUMENTS.length} 문서`)).toBeInTheDocument()
  })
})

describe('FileTree — document selection', () => {
  it('clicking a document sets selectedDocId in uiStore', async () => {
    render(<FileTree />)
    // Find the first document item (any file item button)
    const docButtons = screen.getAllByRole('button').filter(
      btn => btn.getAttribute('data-doc-id')
    )
    expect(docButtons.length).toBeGreaterThan(0)
    await userEvent.click(docButtons[0])
    const { selectedDocId, centerTab } = useUIStore.getState()
    expect(selectedDocId).not.toBeNull()
    expect(centerTab).toBe('document')
  })
})

describe('FileTree — speaker group toggle', () => {
  it('clicking a speaker group header collapses it', async () => {
    render(<FileTree />)
    // Find the "ART" speaker group button
    const artGroupBtn = screen.getByRole('button', { name: /ART/i })
    expect(artGroupBtn).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(artGroupBtn)
    expect(artGroupBtn).toHaveAttribute('aria-expanded', 'false')
  })

  it('clicking a collapsed group expands it again', async () => {
    render(<FileTree />)
    const artGroupBtn = screen.getByRole('button', { name: /ART/i })
    await userEvent.click(artGroupBtn) // collapse
    await userEvent.click(artGroupBtn) // expand
    expect(artGroupBtn).toHaveAttribute('aria-expanded', 'true')
  })
})
