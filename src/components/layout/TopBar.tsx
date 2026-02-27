import { Monitor, Cpu, Sun, Moon, Settings, Plus, Minus, Square, X } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { cn } from '@/lib/utils'
import type { ThemeId } from '@/types'

// ── Theme cycling helpers ──────────────────────────────────────────────────────

const THEME_CYCLE: ThemeId[] = ['dark', 'oled', 'white']

function nextTheme(current: ThemeId): ThemeId {
  const idx = THEME_CYCLE.indexOf(current)
  return THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]
}

function ThemeIcon({ theme }: { theme: ThemeId }) {
  return theme === 'white' ? <Sun size={13} /> : <Moon size={13} />
}

function themeLabel(theme: ThemeId): string {
  if (theme === 'white') return 'LIGHT'
  return theme.toUpperCase()
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TopBar() {
  const { theme, graphMode, panelOpacity, setTheme, setGraphMode, setCenterTab, setPanelOpacity } = useUIStore()
  const { toggleSettingsPanel } = useSettingsStore()

  const isElectron =
    typeof window !== 'undefined' && window.electronAPI?.isElectron === true

  // Draggable region style — applied to the root container so the whole bar
  // can drag the window. Individual buttons override with no-drag.
  const dragStyle = { WebkitAppRegion: 'drag' } as React.CSSProperties
  const noDragStyle = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

  return (
    <div
      style={{ ...dragStyle }}
      className="flex items-center justify-between px-4 h-10 shrink-0 select-none"
    >
      {/* App icon + title */}
      <div className="flex items-center gap-2" style={noDragStyle}>
        <img
          src="/rembrant.svg"
          alt="Rembrandt MAP logo"
          width={20}
          height={20}
          style={{ display: 'block', flexShrink: 0 }}
          draggable={false}
        />
        <span
          className="text-xs font-semibold tracking-widest"
          style={{ color: 'var(--color-text-muted)' }}
        >
          REMBRANDT MAP
        </span>
      </div>

      {/* Right controls — all no-drag so clicks register */}
      <div className="flex items-center gap-1" style={noDragStyle}>

        {/* Panel opacity slider */}
        <div className="flex items-center gap-1.5 px-2">
          <span style={{ fontSize: 9, color: 'var(--color-text-muted)', lineHeight: 1 }}>◈</span>
          <input
            type="range"
            min={0.3}
            max={0.97}
            step={0.01}
            value={panelOpacity}
            onChange={e => {
              const val = parseFloat(e.target.value)
              setPanelOpacity(val)
              // Immediate CSS update for instant visual feedback (no re-render wait)
              document.documentElement.style.setProperty('--panel-opacity', val.toString())
            }}
            style={{
              width: 56,
              accentColor: 'var(--color-accent)',
              cursor: 'pointer',
              outline: 'none',
            }}
            title="Panel opacity"
            aria-label="Adjust panel opacity"
          />
        </div>

        {/* MD Converter "+" button — opens editor panel */}
        <button
          onClick={() => setCenterTab('editor')}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors',
            'hover:bg-[var(--color-bg-hover)]'
          )}
          style={{ color: 'var(--color-text-secondary)' }}
          title="MD 변환 툴"
          aria-label="MD 변환 툴 열기"
        >
          <Plus size={13} />
        </button>

        {/* 3D / 2D toggle */}
        <button
          onClick={() => setGraphMode(graphMode === '3d' ? '2d' : '3d')}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors',
            'hover:bg-[var(--color-bg-hover)]'
          )}
          style={{ color: 'var(--color-text-secondary)' }}
          title={`Switch to ${graphMode === '3d' ? '2D' : '3D'} graph`}
          aria-label={`Switch to ${graphMode === '3d' ? '2D' : '3D'} graph`}
        >
          <Monitor size={13} />
          <span>{graphMode.toUpperCase()}</span>
        </button>

        {/* Theme cycle toggle: dark → oled → white → dark */}
        <button
          onClick={() => setTheme(nextTheme(theme))}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors',
            'hover:bg-[var(--color-bg-hover)]'
          )}
          style={{ color: 'var(--color-text-secondary)' }}
          title={`Switch to ${nextTheme(theme)} theme`}
          aria-label="Toggle theme"
        >
          <ThemeIcon theme={theme} />
          <span>{themeLabel(theme)}</span>
        </button>

        {/* Settings button */}
        <button
          onClick={toggleSettingsPanel}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors',
            'hover:bg-[var(--color-bg-hover)]'
          )}
          style={{ color: 'var(--color-text-secondary)' }}
          title="AI Model Settings"
          aria-label="Open AI model settings"
          data-testid="settings-button"
        >
          <Settings size={13} />
        </button>

        {/* Version indicator */}
        <span
          className="flex items-center gap-1 px-2 py-1 rounded text-xs"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <Cpu size={11} />
          <span>v0.3.0</span>
        </span>

        {/* Window controls — only visible in Electron frameless mode */}
        {isElectron && (
          <div className="flex items-center ml-1">
            <button
              onClick={() => window.windowAPI?.minimize()}
              className="flex items-center justify-center w-8 h-8 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
              style={{ color: 'var(--color-text-muted)' }}
              title="Minimize"
              aria-label="Minimize window"
            >
              <Minus size={12} />
            </button>
            <button
              onClick={() => window.windowAPI?.maximize()}
              className="flex items-center justify-center w-8 h-8 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
              style={{ color: 'var(--color-text-muted)' }}
              title="Maximize / Restore"
              aria-label="Maximize or restore window"
            >
              <Square size={11} />
            </button>
            <button
              onClick={() => window.windowAPI?.close()}
              className="flex items-center justify-center w-8 h-8 rounded transition-colors hover:bg-red-500"
              style={{ color: 'var(--color-text-muted)' }}
              title="Close"
              aria-label="Close window"
            >
              <X size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
