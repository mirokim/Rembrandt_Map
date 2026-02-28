/**
 * WikiLink WYSIWYG extension for CodeMirror 6.
 *
 * On lines where the cursor is absent, [[WikiLink]] syntax is replaced with a
 * rendered clickable widget (Obsidian style). On the active cursor line the raw
 * [[...]] syntax is visible for editing.
 */

import { EditorView, ViewPlugin, Decoration, WidgetType } from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import type { Range } from '@codemirror/state'

// ── WikiLink Widget ───────────────────────────────────────────────────────────

export class WikiLinkWidget extends WidgetType {
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

// ── WikiLink ViewPlugin ───────────────────────────────────────────────────────

export function buildWikiLinkPlugin(onLinkClick: (slug: string) => void) {
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

// ── ==Highlight== decorator ───────────────────────────────────────────────────

export function buildHighlightPlugin() {
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

// ── %% 주석 %% decorator ──────────────────────────────────────────────────────

export function buildCommentPlugin() {
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
