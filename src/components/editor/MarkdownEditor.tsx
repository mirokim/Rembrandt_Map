/**
 * MarkdownEditor — CodeMirror 6 기반 볼트 파일 편집기
 *
 * [[WikiLink]] WYSIWYG: 커서가 없는 줄에서는 렌더링된 링크로 표시.
 * 커서가 있는 줄에서는 원시 [[...]] 문법이 보임 (Obsidian 스타일).
 * [[ 입력 시 자동완성: React portal 드롭다운으로 정확한 위치 표시.
 *
 * Lock = 편집 권한 잠금 (read-only). 나중에 다중 사용자 권한 제어에 사용.
 * Auto-save 3s debounce + Ctrl+S. 저장 시 wikiLinks가 변경되면 그래프 재빌드.
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { EditorView, ViewPlugin, Decoration, WidgetType, keymap, drawSelection, highlightActiveLine } from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import type { Range } from '@codemirror/state'
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { markdown } from '@codemirror/lang-markdown'
import { tags } from '@lezer/highlight'
import { ArrowLeft, Save, CheckCircle, AlertCircle, X, Lock, Unlock, Pencil } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'
import { useVaultStore } from '@/stores/vaultStore'
import { useGraphStore } from '@/stores/graphStore'
import { parseMarkdownFile, parseVaultFiles } from '@/lib/markdownParser'
import { buildGraph } from '@/lib/graphBuilder'
import { MOCK_DOCUMENTS } from '@/data/mockDocuments'
import type { LoadedDocument, MockDocument } from '@/types'

const AUTOSAVE_DELAY = 3000

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface DocInfo { name: string; folder: string }

// ── WikiLink WYSIWYG ──────────────────────────────────────────────────────────

class WikiLinkWidget extends WidgetType {
  constructor(
    readonly slug: string,
    readonly display: string,
    readonly onClick: (slug: string) => void,
  ) {
    super()
  }

  toDOM() {
    const el = document.createElement('span')
    el.textContent = this.display
    el.className = 'cm-wikilink-widget'
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      this.onClick(this.slug)
    })
    return el
  }

  eq(other: WikiLinkWidget) {
    return other.slug === this.slug && other.display === this.display
  }

  ignoreEvent() { return false }
}

function buildWikiLinkPlugin(onLinkClick: (slug: string) => void) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = this.compute(view)
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = this.compute(update.view)
        }
      }

      compute(view: EditorView): DecorationSet {
        const { state } = view
        const cursorLine = state.doc.lineAt(state.selection.main.head).number
        const widgets: Range<Decoration>[] = []
        const wikiRe = /\[\[([^\]]+)\]\]/g

        for (const { from, to } of view.visibleRanges) {
          const text = state.doc.sliceString(from, to)
          let match
          while ((match = wikiRe.exec(text)) !== null) {
            const start = from + match.index
            const end = start + match[0].length
            if (state.doc.lineAt(start).number === cursorLine) continue

            const inner = match[1]
            const parts = inner.split('|')
            const slug = parts[0].split('#')[0].trim()
            const display = parts.length > 1 ? parts[1].trim() : slug

            widgets.push(
              Decoration.replace({
                widget: new WikiLinkWidget(slug, display, onLinkClick),
              }).range(start, end),
            )
          }
        }

        return Decoration.set(widgets.sort((a, b) => a.from - b.from))
      }
    },
    { decorations: (v) => v.decorations },
  )
}

// ── ==Highlight== 데코레이터 ───────────────────────────────────────────────────

function buildHighlightPlugin() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) { this.decorations = this.compute(view) }
      update(u: ViewUpdate) {
        if (u.docChanged || u.selectionSet || u.viewportChanged)
          this.decorations = this.compute(u.view)
      }
      compute(view: EditorView): DecorationSet {
        const { state } = view
        const decs: Range<Decoration>[] = []
        const re = /==([^=\n]+)==/g
        for (const { from, to } of view.visibleRanges) {
          const text = state.doc.sliceString(from, to)
          let m
          while ((m = re.exec(text)) !== null) {
            decs.push(Decoration.mark({ class: 'cm-highlight-mark' }).range(from + m.index, from + m.index + m[0].length))
          }
        }
        return Decoration.set(decs.sort((a, b) => a.from - b.from))
      }
    },
    { decorations: v => v.decorations },
  )
}

// ── %% 주석 %% 데코레이터 ──────────────────────────────────────────────────────

function buildCommentPlugin() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) { this.decorations = this.compute(view) }
      update(u: ViewUpdate) {
        if (u.docChanged || u.selectionSet || u.viewportChanged)
          this.decorations = this.compute(u.view)
      }
      compute(view: EditorView): DecorationSet {
        const { state } = view
        const decs: Range<Decoration>[] = []
        const re = /%%[\s\S]*?%%/g
        for (const { from, to } of view.visibleRanges) {
          const text = state.doc.sliceString(from, to)
          let m
          while ((m = re.exec(text)) !== null) {
            decs.push(Decoration.mark({ class: 'cm-comment-mark' }).range(from + m.index, from + m.index + m[0].length))
          }
        }
        return Decoration.set(decs.sort((a, b) => a.from - b.from))
      }
    },
    { decorations: v => v.decorations },
  )
}

// ── Markdown Syntax Highlighting ─────────────────────────────────────────────

const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.5em', fontWeight: '700' },
  { tag: tags.heading2, fontSize: '1.35em', fontWeight: '700' },
  { tag: tags.heading3, fontSize: '1.15em', fontWeight: '600' },
  { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: '600' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through', color: 'var(--color-text-muted)' },
  { tag: tags.link, color: 'var(--color-accent)' },
  { tag: tags.url, color: 'var(--color-text-muted)', fontSize: '0.9em' },
  { tag: tags.processingInstruction, color: 'var(--color-text-muted)' },
  { tag: tags.comment, color: 'var(--color-text-muted)', fontStyle: 'italic' },
  { tag: tags.meta, color: 'var(--color-text-muted)', fontSize: '0.85em' },
  { tag: tags.monospace, fontFamily: 'inherit', color: '#a3d977' },
])

// ── Editor Chrome Theme ───────────────────────────────────────────────────────

const vaultTheme = EditorView.theme({
  '&': { height: '100%', background: 'transparent' },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, "Cascadia Code", Consolas, monospace',
    fontSize: '13px',
    lineHeight: '1.7',
    padding: '16px 20px',
  },
  '.cm-content': { caretColor: 'var(--color-accent)', padding: '0' },
  '.cm-line': { padding: '0', color: 'var(--color-text-secondary)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-accent)' },
  '.cm-selectionBackground': { background: 'rgba(99,140,255,0.2)' },
  '&.cm-focused .cm-selectionBackground': { background: 'rgba(99,140,255,0.25)' },
  '.cm-gutters': { display: 'none' },
  '.cm-activeLine': { background: 'rgba(255,255,255,0.03)' },
  '.cm-wikilink-widget': {
    color: 'var(--color-accent)',
    cursor: 'pointer',
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
    textDecorationColor: 'color-mix(in srgb, var(--color-accent) 50%, transparent)',
  },
  '.cm-highlight-mark': {
    background: 'rgba(255, 210, 0, 0.22)',
    borderRadius: '2px',
    padding: '1px 0',
  },
  '.cm-comment-mark': {
    color: 'var(--color-text-muted)',
    opacity: '0.5',
    fontStyle: 'italic',
  },
  '&.cm-readonly .cm-content': { opacity: '0.6' },
})

// ── WikiLink Suggest 드롭다운 (React portal) ──────────────────────────────────

interface WikiSuggestState {
  query: string
  from: number   // editor 내 [[ 다음 위치
  to: number     // 현재 커서 위치
  rect: { top: number; bottom: number; left: number }
  selectedIdx: number
}

interface SuggestDropdownProps {
  docs: DocInfo[]
  selectedIdx: number
  rect: WikiSuggestState['rect']
  onSelect: (name: string) => void
}

function SuggestDropdown({ docs, selectedIdx, rect, onSelect }: SuggestDropdownProps) {
  const listRef = useRef<HTMLDivElement>(null)

  // 선택된 항목이 보이도록 스크롤
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const item = list.children[selectedIdx] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [selectedIdx])

  if (docs.length === 0) return null

  return createPortal(
    <div
      ref={listRef}
      style={{
        position: 'fixed',
        top: rect.bottom + 4,
        left: rect.left,
        zIndex: 99999,
        background: 'var(--color-bg-overlay)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 7,
        boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
        overflow: 'hidden',
        maxHeight: 220,
        overflowY: 'auto',
        minWidth: 180,
      }}
    >
      {docs.map(({ name, folder }, i) => (
        <div
          key={name}
          onMouseDown={(e) => {
            e.preventDefault() // 에디터 포커스 유지
            onSelect(name)
          }}
          style={{
            padding: '5px 12px',
            cursor: 'pointer',
            fontSize: 12,
            fontFamily: 'ui-monospace, "Cascadia Code", Consolas, monospace',
            background: i === selectedIdx ? 'rgba(255,255,255,0.09)' : 'transparent',
            color: i === selectedIdx ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </span>
          {folder && (
            <span style={{ fontSize: 10, color: 'var(--color-text-muted)', flexShrink: 0 }}>
              {folder}
            </span>
          )}
        </div>
      ))}
    </div>,
    document.body,
  )
}

// ── Markdown Editing Helpers ─────────────────────────────────────────────────
// Obsidian 스타일 리스트 / 인라인 서식 키바인딩용 순수 함수들

/** 리스트 항목 줄 탐지 정규식 */
const LIST_RE = /^(\s*)([-*+]|\d+\.)( \[[ xX]\])? /

/** 번호 목록: 특정 인덴트 레벨에서 바로 위의 항목 번호 반환 (없으면 0) */
function prevNumAtIndent(state: EditorState, fromLine: number, indentLen: number): number {
  for (let n = fromLine - 1; n >= 1; n--) {
    const text = state.doc.line(n).text
    if (text.trim() === '') continue
    const m = text.match(/^(\s*)(\d+\.)/)
    if (m) {
      const d = m[1].length
      if (d === indentLen) return parseInt(m[2])
      if (d < indentLen) return 0  // 상위 레벨 — 같은 레벨 없음
    } else if (!LIST_RE.test(text)) {
      return 0  // 리스트 아닌 줄 — 탐색 중단
    }
  }
  return 0
}

/** Tab: 리스트 항목 들여쓰기 (+2 spaces), 번호 목록은 레벨별 번호 재계산 */
function mdIndentList(view: EditorView): boolean {
  const { state } = view
  const { from, to } = state.selection.main
  if (from !== to) return false
  const line = state.doc.lineAt(from)
  if (!LIST_RE.test(line.text)) return false

  // 번호 목록: 새 인덴트 레벨에 맞는 번호 계산
  const numM = line.text.match(/^(\s*)(\d+\.)( .*)/)
  if (numM) {
    const newIndentLen = numM[1].length + 2
    const prev = prevNumAtIndent(state, line.number, newIndentLen)
    const newNum = prev > 0 ? prev + 1 : 1
    const oldMarker = numM[2]
    const newMarker = `${newNum}.`
    const newText = `  ${numM[1]}${newMarker}${numM[3]}`
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: newText },
      selection: { anchor: from + 2 + (newMarker.length - oldMarker.length) },
      userEvent: 'input.indent',
    })
    return true
  }

  // 불릿 목록: 2 spaces 추가
  view.dispatch({
    changes: { from: line.from, insert: '  ' },
    selection: { anchor: from + 2 },
    userEvent: 'input.indent',
  })
  return true
}

/** Shift-Tab: 리스트 항목 내어쓰기 (-2 spaces) */
function mdDedentList(view: EditorView): boolean {
  const { state } = view
  const { from, to } = state.selection.main
  if (from !== to) return false
  const line = state.doc.lineAt(from)
  if (!LIST_RE.test(line.text)) return false
  const spaces = (line.text.match(/^( +)/) ?? ['', ''])[1].length
  if (spaces < 2) return false
  const remove = Math.min(2, spaces)
  view.dispatch({
    changes: { from: line.from, to: line.from + remove, insert: '' },
    selection: { anchor: Math.max(line.from, from - remove) },
    userEvent: 'delete.dedent',
  })
  return true
}

/** Enter: 리스트 항목 연속 생성 / 빈 항목이면 리스트 탈출 */
function mdContinueList(view: EditorView): boolean {
  const { state } = view
  const { from, to } = state.selection.main
  if (from !== to) return false
  const line = state.doc.lineAt(from)
  const m = line.text.match(/^(\s*)([-*+]|\d+\.)( \[[ xX]\])? (.*)$/)
  if (!m) return false
  const [, indent, marker, checkbox = '', content] = m

  // 빈 항목 + 커서가 줄 끝 → 리스트 탈출 (불릿 프리픽스 제거)
  if (!content.trim() && from === line.to) {
    const prefixLen = indent.length + marker.length + checkbox.length + 1
    view.dispatch({
      changes: { from: line.from, to: line.from + prefixLen, insert: '' },
      selection: { anchor: line.from },
      userEvent: 'input',
    })
    return true
  }

  // 커서가 줄 중간이면 기본 Enter 처리로 위임
  if (from < line.to) return false

  // 번호 목록: 같은 인덴트 레벨의 다음 번호
  let nextMarker = marker
  const numMatch = marker.match(/^(\d+)\.$/)
  if (numMatch) {
    const prev = prevNumAtIndent(state, line.number, indent.length)
    const base = prev > 0 ? prev : parseInt(numMatch[1])
    nextMarker = `${base + 1}.`
  }

  // 체크박스: 새 항목은 미완료로
  const nextCheckbox = checkbox ? ' [ ]' : ''
  const newLine = `\n${indent}${nextMarker}${nextCheckbox} `

  view.dispatch({
    changes: { from, insert: newLine },
    selection: { anchor: from + newLine.length },
    userEvent: 'input',
  })
  return true
}

/** Ctrl+B / Ctrl+I: 인라인 마크 토글 (** 또는 *) */
function mdToggleMark(view: EditorView, mark: string): boolean {
  const { state } = view
  const { from, to } = state.selection.main
  const mlen = mark.length

  if (from === to) {
    // 선택 없음: 마크 쌍 삽입 후 커서를 가운데
    view.dispatch({
      changes: { from, insert: mark + mark },
      selection: { anchor: from + mlen },
      userEvent: 'input',
    })
    return true
  }

  // 이미 감싸져 있으면 제거
  const before = state.doc.sliceString(from - mlen, from)
  const after  = state.doc.sliceString(to, to + mlen)
  if (before === mark && after === mark) {
    view.dispatch({
      changes: [
        { from: from - mlen, to: from, insert: '' },
        { from: to, to: to + mlen, insert: '' },
      ],
      selection: { anchor: from - mlen, head: to - mlen },
      userEvent: 'delete',
    })
  } else {
    view.dispatch({
      changes: [{ from, insert: mark }, { from: to, insert: mark }],
      selection: { anchor: from + mlen, head: to + mlen },
      userEvent: 'input',
    })
  }
  return true
}

/** Enter: 인용구(>) 연속 생성 / 빈 항목이면 인용구 탈출 */
function mdContinueBlockquote(view: EditorView): boolean {
  const { state } = view
  const { from, to } = state.selection.main
  if (from !== to) return false
  const line = state.doc.lineAt(from)
  // `> ` 또는 `>> ` 등 중첩 인용구 패턴
  const m = line.text.match(/^((?:> ?)+)(.*)$/)
  if (!m) return false
  const [, prefix, content] = m

  // 빈 항목 + 커서 줄 끝 → 인용구 탈출 (프리픽스 제거)
  if (!content.trim() && from === line.to) {
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: '' },
      selection: { anchor: line.from },
      userEvent: 'input',
    })
    return true
  }

  // 커서가 줄 중간이면 기본 Enter 처리로 위임
  if (from < line.to) return false

  const newLine = `\n${prefix}`
  view.dispatch({
    changes: { from, insert: newLine },
    selection: { anchor: from + newLine.length },
    userEvent: 'input',
  })
  return true
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MarkdownEditor() {
  const { editingDocId, closeEditor, openInEditor } = useUIStore()
  const { loadedDocuments, setLoadedDocuments, vaultPath } = useVaultStore()
  const { setNodes, setLinks } = useGraphStore()

  const doc = (
    loadedDocuments?.find(d => d.id === editingDocId) ??
    MOCK_DOCUMENTS.find(d => d.id === editingDocId)
  ) as (LoadedDocument | MockDocument) | undefined

  const absolutePath = (doc as LoadedDocument)?.absolutePath ?? ''
  const canSave = Boolean(absolutePath && window.vaultAPI)

  const [isLocked, setIsLocked] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [wikiSuggest, setWikiSuggest] = useState<WikiSuggestState | null>(null)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const isRenamingRef = useRef(false)
  const renameValueRef = useRef('')
  renameValueRef.current = renameValue

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isDirty = useRef(false)

  const editorMountRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const readOnlyCompartment = useRef(new Compartment())

  // 자동완성용 문서 목록 (항상 최신값)
  const docInfoRef = useRef<DocInfo[]>([])
  docInfoRef.current = loadedDocuments?.map(d => ({
    name: d.filename.replace(/\.md$/i, ''),
    folder: d.folderPath || '',
  })) ?? []

  // Stable mutable refs
  const loadedDocsRef = useRef(loadedDocuments)
  loadedDocsRef.current = loadedDocuments
  const docRef = useRef(doc)
  docRef.current = doc
  const canSaveRef = useRef(canSave)
  canSaveRef.current = canSave
  const absolutePathRef = useRef(absolutePath)
  absolutePathRef.current = absolutePath

  const setWikiSuggestRef = useRef(setWikiSuggest)
  setWikiSuggestRef.current = setWikiSuggest
  const wikiSuggestRef = useRef(wikiSuggest)
  wikiSuggestRef.current = wikiSuggest

  // 현재 query 기준 필터링된 문서 목록 (렌더마다 재계산)
  const filteredDocs = wikiSuggest
    ? docInfoRef.current.filter(d => {
        const q = wikiSuggest.query.toLowerCase()
        return q === '' || d.name.toLowerCase().includes(q)
      })
    : []
  const clampedIdx = filteredDocs.length > 0
    ? Math.min(wikiSuggest?.selectedIdx ?? 0, filteredDocs.length - 1)
    : 0

  // ── 이름 변경 ─────────────────────────────────────────────────────────────

  const startRename = useCallback(() => {
    if (!canSave) return
    const currentDoc = docRef.current as LoadedDocument
    if (!currentDoc?.absolutePath) return
    setRenameValue(currentDoc.filename.replace(/\.md$/i, ''))
    isRenamingRef.current = true
    setIsRenaming(true)
    setTimeout(() => { renameInputRef.current?.select() }, 20)
  }, [canSave])

  const commitRename = useCallback(async () => {
    // Enter 키 + onBlur 이중 호출 방어
    if (!isRenamingRef.current) return
    isRenamingRef.current = false
    setIsRenaming(false)
    const value = renameValueRef.current
    const currentDoc = docRef.current as LoadedDocument
    if (!currentDoc?.absolutePath || !value.trim()) return
    const newFilename = value.trim().endsWith('.md')
      ? value.trim()
      : `${value.trim()}.md`
    if (newFilename === currentDoc.filename) return
    try {
      await window.vaultAPI!.renameFile(currentDoc.absolutePath, newFilename)
      if (vaultPath && window.vaultAPI) {
        const files = await window.vaultAPI.loadFiles(vaultPath)
        if (files) {
          const docs = parseVaultFiles(files) as LoadedDocument[]
          setLoadedDocuments(docs)
          const { nodes, links } = buildGraph(docs)
          setNodes(nodes)
          setLinks(links)
          const sep = currentDoc.absolutePath.includes('\\') ? '\\' : '/'
          const dir = currentDoc.absolutePath.replace(/[\\/][^\\/]+$/, '')
          const newAbsPath = `${dir}${sep}${newFilename}`
          const newDoc = docs.find(d =>
            d.absolutePath.replace(/\\/g, '/') === newAbsPath.replace(/\\/g, '/')
          )
          if (newDoc) openInEditor(newDoc.id)
        }
      }
    } catch (e) {
      console.error('[MarkdownEditor] rename failed:', e)
    }
  }, [vaultPath, setLoadedDocuments, setNodes, setLinks, openInEditor])

  // ── 저장 ──────────────────────────────────────────────────────────────────

  const doSave = useCallback(async (text: string) => {
    if (!canSaveRef.current) return
    const path = absolutePathRef.current
    if (!path) return

    setSaveStatus('saving')
    try {
      await window.vaultAPI!.saveFile(path, text)

      const currentDoc = docRef.current as LoadedDocument
      if (loadedDocsRef.current && currentDoc?.absolutePath) {
        const relativePath = currentDoc.folderPath
          ? `${currentDoc.folderPath}/${currentDoc.filename}`
          : currentDoc.filename
        const reparsed = parseMarkdownFile({
          relativePath,
          absolutePath: path,
          content: text,
          mtime: Date.now(),
        })

        const updated = loadedDocsRef.current.map(d =>
          d.id === currentDoc.id ? reparsed : d,
        ) as LoadedDocument[]
        setLoadedDocuments(updated)

        const oldLinks = currentDoc.sections.flatMap(s => s.wikiLinks).sort().join(',')
        const newLinks = reparsed.sections.flatMap(s => s.wikiLinks).sort().join(',')
        if (oldLinks !== newLinks) {
          const { nodes, links } = buildGraph(updated)
          setNodes(nodes)
          setLinks(links)
        }
      }

      setSaveStatus('saved')
      isDirty.current = false
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch (e) {
      console.error('[MarkdownEditor] save failed:', e)
      setSaveStatus('error')
    }
  }, [setLoadedDocuments, setNodes, setLinks])

  const doSaveRef = useRef(doSave)
  doSaveRef.current = doSave

  const handleManualSave = useCallback(() => {
    if (!viewRef.current) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    doSaveRef.current(viewRef.current.state.doc.toString())
  }, [])

  const handleManualSaveRef = useRef(handleManualSave)
  handleManualSaveRef.current = handleManualSave

  // ── WikiLink 클릭 탐색 ─────────────────────────────────────────────────────

  const handleLinkClick = useCallback((slug: string) => {
    const target = loadedDocsRef.current?.find(d =>
      d.filename.replace(/\.md$/i, '').toLowerCase() === slug.toLowerCase(),
    )
    if (target) openInEditor(target.id)
  }, [openInEditor])

  const handleLinkClickRef = useRef(handleLinkClick)
  handleLinkClickRef.current = handleLinkClick

  // ── WikiLink 자동완성 확정 ─────────────────────────────────────────────────

  const applyWikiSuggest = useCallback((name: string) => {
    const view = viewRef.current
    const suggest = wikiSuggestRef.current
    if (!view || !suggest) return
    const textAfter = view.state.doc.sliceString(suggest.to, suggest.to + 2)
    const closeStr = textAfter === ']]' ? '' : ']]'
    const insert = name + closeStr
    view.dispatch({
      changes: { from: suggest.from, to: suggest.to, insert },
      selection: { anchor: suggest.from + insert.length },
    })
    setWikiSuggestRef.current(null)
    view.focus()
  }, [])

  const applyRef = useRef(applyWikiSuggest)
  applyRef.current = applyWikiSuggest

  // ── EditorView 초기화 ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!editorMountRef.current || !doc) return

    viewRef.current?.destroy()
    viewRef.current = null
    isDirty.current = false
    setSaveStatus('idle')
    setWikiSuggestRef.current(null)

    const wikiPlugin = buildWikiLinkPlugin((slug) => handleLinkClickRef.current(slug))

    const view = new EditorView({
      state: EditorState.create({
        doc: doc.rawContent ?? '',
        extensions: [
          history(),
          drawSelection(),
          highlightActiveLine(),
          keymap.of([
            // WikiLink 자동완성 키 (defaultKeymap보다 먼저 등록)
            {
              key: 'ArrowDown',
              run: () => {
                if (!wikiSuggestRef.current) return false
                const docs = docInfoRef.current.filter(d => {
                  const q = wikiSuggestRef.current!.query.toLowerCase()
                  return q === '' || d.name.toLowerCase().includes(q)
                })
                setWikiSuggestRef.current(prev =>
                  prev ? { ...prev, selectedIdx: Math.min(prev.selectedIdx + 1, docs.length - 1) } : null,
                )
                return true
              },
            },
            {
              key: 'ArrowUp',
              run: () => {
                if (!wikiSuggestRef.current) return false
                setWikiSuggestRef.current(prev =>
                  prev ? { ...prev, selectedIdx: Math.max(prev.selectedIdx - 1, 0) } : null,
                )
                return true
              },
            },
            {
              key: 'Enter',
              run: () => {
                const suggest = wikiSuggestRef.current
                if (!suggest) return false
                const docs = docInfoRef.current.filter(d => {
                  const q = suggest.query.toLowerCase()
                  return q === '' || d.name.toLowerCase().includes(q)
                })
                const idx = Math.min(suggest.selectedIdx, docs.length - 1)
                const selected = docs[idx]
                if (selected) { applyRef.current(selected.name); return true }
                return false
              },
            },
            {
              key: 'Escape',
              run: () => {
                if (!wikiSuggestRef.current) return false
                setWikiSuggestRef.current(null)
                return true
              },
            },
            // ── Markdown 리스트 들여쓰기 ──
            { key: 'Tab',       run: mdIndentList },
            { key: 'Shift-Tab', run: mdDedentList },
            // ── 리스트 / 인용구 연속 생성 (WikiSuggest가 비활성일 때만) ──
            {
              key: 'Enter',
              run: (view) => {
                if (wikiSuggestRef.current) return false
                if (mdContinueList(view)) return true
                return mdContinueBlockquote(view)
              },
            },
            // ── 인라인 서식 ──
            { key: 'Ctrl-b',       run: (view) => mdToggleMark(view, '**') },
            { key: 'Mod-b',        run: (view) => mdToggleMark(view, '**') },
            { key: 'Ctrl-i',       run: (view) => mdToggleMark(view, '*') },
            { key: 'Mod-i',        run: (view) => mdToggleMark(view, '*') },
            { key: 'Ctrl-Shift-s', run: (view) => mdToggleMark(view, '~~') },
            { key: 'Mod-Shift-s',  run: (view) => mdToggleMark(view, '~~') },
            { key: 'Ctrl-Shift-h', run: (view) => mdToggleMark(view, '==') },
            { key: 'Mod-Shift-h',  run: (view) => mdToggleMark(view, '==') },
            { key: 'Ctrl-Shift-c', run: (view) => mdToggleMark(view, '`') },
            { key: 'Mod-Shift-c',  run: (view) => mdToggleMark(view, '`') },
            ...defaultKeymap,
            ...historyKeymap,
            { key: 'Ctrl-s', run: () => { handleManualSaveRef.current(); return true } },
            { key: 'Mod-s', run: () => { handleManualSaveRef.current(); return true } },
          ]),
          markdown(),
          syntaxHighlighting(markdownHighlight),
          wikiPlugin,
          buildHighlightPlugin(),
          buildCommentPlugin(),
          vaultTheme,
          EditorView.lineWrapping,
          readOnlyCompartment.current.of([]),
          EditorView.updateListener.of((update) => {
            // 자동저장
            if (update.docChanged) {
              isDirty.current = true
              setSaveStatus('idle')
              if (saveTimer.current) clearTimeout(saveTimer.current)
              const text = update.state.doc.toString()
              saveTimer.current = setTimeout(() => doSaveRef.current(text), AUTOSAVE_DELAY)
            }

            // [[ 자동완성 감지
            if (update.docChanged || update.selectionSet) {
              const { state } = update
              const cursor = state.selection.main.head
              const line = state.doc.lineAt(cursor)
              const textBefore = line.text.slice(0, cursor - line.from)
              const match = textBefore.match(/\[\[([^\]]*)$/)

              if (match) {
                const coords = update.view.coordsAtPos(cursor)
                if (coords) {
                  const from = cursor - match[1].length
                  setWikiSuggestRef.current(prev => ({
                    query: match[1],
                    from,
                    to: cursor,
                    rect: coords,
                    selectedIdx: prev?.query === match[1] ? prev.selectedIdx : 0,
                  }))
                }
              } else {
                setWikiSuggestRef.current(null)
              }
            }
          }),
        ],
      }),
      parent: editorMountRef.current,
    })

    viewRef.current = view

    return () => {
      if (isDirty.current && saveTimer.current) {
        clearTimeout(saveTimer.current)
        doSaveRef.current(view.state.doc.toString())
      }
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id])

  // Lock 토글
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartment.current.reconfigure(
        isLocked ? EditorState.readOnly.of(true) : [],
      ),
    })
  }, [isLocked])

  // ── 문서 없음 ─────────────────────────────────────────────────────────────

  if (!doc) {
    return (
      <div
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', gap: 12, height: '100%',
          color: 'var(--color-text-muted)', fontSize: 13,
        }}
      >
        <span>열린 파일이 없습니다</span>
        <button
          onClick={closeEditor}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'var(--color-bg-overlay)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 6, color: 'var(--color-text-secondary)', cursor: 'pointer',
            padding: '6px 14px', fontSize: 12, transition: 'color 0.15s, border-color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-text-primary)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-secondary)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)' }}
        >
          <ArrowLeft size={13} />
          그래프로 돌아가기
        </button>
      </div>
    )
  }

  const displayName = doc.filename.replace(/\.md$/i, '')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ── Toolbar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        <button
          onClick={closeEditor}
          style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '3px 6px', borderRadius: 4, fontSize: 11, transition: 'color 0.1s' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text-primary)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
          title="에디터 닫기"
        >
          <ArrowLeft size={13} />
        </button>

        {isRenaming ? (
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename() }
              if (e.key === 'Escape') { e.preventDefault(); isRenamingRef.current = false; setIsRenaming(false) }
            }}
            style={{
              flex: 1, fontSize: 12, fontWeight: 500,
              background: 'var(--color-bg-surface)',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-accent)',
              borderRadius: 4, padding: '1px 6px', outline: 'none',
            }}
            autoFocus
          />
        ) : (
          <button
            onClick={canSave ? startRename : undefined}
            title={canSave ? '클릭하여 이름 변경' : doc.filename}
            style={{
              flex: 1, fontSize: 12, fontWeight: 500,
              color: 'var(--color-text-primary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              background: 'transparent', border: 'none',
              cursor: canSave ? 'text' : 'default',
              textAlign: 'left', padding: 0,
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</span>
            {canSave && <Pencil size={10} style={{ flexShrink: 0, color: 'var(--color-text-muted)', opacity: 0.5 }} />}
          </button>
        )}

        <button
          onClick={() => setIsLocked(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, color: isLocked ? '#f87171' : 'var(--color-text-muted)', cursor: 'pointer', padding: '3px 7px', fontSize: 11, transition: 'color 0.15s, border-color 0.15s' }}
          title={isLocked ? '잠금 해제 (편집 허용)' : '잠금 (편집 제한)'}
        >
          {isLocked ? <Lock size={11} /> : <Unlock size={11} />}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: !canSave ? 'var(--color-text-muted)' : saveStatus === 'saved' ? '#34d399' : saveStatus === 'error' ? '#f87171' : 'var(--color-text-muted)', transition: 'color 0.2s' }}>
          {!canSave && '읽기 전용'}
          {canSave && saveStatus === 'saved' && <><CheckCircle size={11} />저장됨</>}
          {canSave && saveStatus === 'saving' && '저장 중…'}
          {canSave && saveStatus === 'error' && <><AlertCircle size={11} />저장 실패</>}
        </div>

        <button
          onClick={handleManualSave}
          disabled={!canSave}
          style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, color: 'var(--color-text-muted)', cursor: canSave ? 'pointer' : 'not-allowed', opacity: canSave ? 1 : 0.3, padding: '3px 7px', fontSize: 11, transition: 'color 0.1s, border-color 0.1s' }}
          onMouseEnter={e => { if (canSave) { e.currentTarget.style.color = 'var(--color-text-primary)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)' } }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-muted)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)' }}
          title={canSave ? '저장 (Ctrl+S)' : '볼트 파일이 아니면 저장할 수 없습니다'}
        >
          <Save size={11} />
        </button>

        <button
          onClick={closeEditor}
          style={{ display: 'flex', alignItems: 'center', background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '3px', borderRadius: 4, transition: 'color 0.1s' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text-primary)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
          title="닫기"
        >
          <X size={13} />
        </button>
      </div>

      {/* ── Metadata bar ── */}
      {((doc as LoadedDocument).folderPath || doc.tags?.length > 0) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
          {(doc as LoadedDocument).folderPath && (
            <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
              📁 {(doc as LoadedDocument).folderPath}
            </span>
          )}
          {doc.tags?.map(tag => (
            <span key={tag} style={{ fontSize: 10, color: 'var(--color-accent)', background: 'var(--color-bg-active)', borderRadius: 3, padding: '1px 5px' }}>
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* ── CodeMirror 에디터 ── */}
      <div ref={editorMountRef} style={{ flex: 1, minHeight: 0 }} />

      {/* ── WikiLink 자동완성 드롭다운 (React portal → document.body) ── */}
      {wikiSuggest && filteredDocs.length > 0 && (
        <SuggestDropdown
          docs={filteredDocs}
          selectedIdx={clampedIdx}
          rect={wikiSuggest.rect}
          onSelect={applyWikiSuggest}
        />
      )}
    </div>
  )
}
