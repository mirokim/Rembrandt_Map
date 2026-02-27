import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import TopBar from './TopBar'
import ResizeHandle from './ResizeHandle'
import FileTree from '@/components/fileTree/FileTree'
import GraphPanel from '@/components/graph/GraphPanel'
import DocViewer from '@/components/docViewer/DocViewer'
import ChatPanel from '@/components/chat/ChatPanel'
import SettingsPanel from '@/components/settings/SettingsPanel'
import ConverterEditor from '@/components/converter/ConverterEditor'
import { useUIStore } from '@/stores/uiStore'

const LEFT_MIN = 140
const LEFT_MAX = 340
const RIGHT_MIN = 260
const RIGHT_MAX = 480

const PANEL_SPRING = { type: 'spring', stiffness: 280, damping: 28 } as const
const OVERLAY_TRANSITION = { duration: 0.2 }

// Shared glass panel style
const glassPanelStyle = {
  background: 'var(--color-bg-overlay)',
  backdropFilter: 'blur(14px)',
  WebkitBackdropFilter: 'blur(14px)',
  borderRadius: 10,
  overflow: 'hidden' as const,
  border: '1px solid rgba(255,255,255,0.04)',
}

export default function MainLayout() {
  const { centerTab } = useUIStore()
  const [leftWidth, setLeftWidth] = useState(186)
  const [rightWidth, setRightWidth] = useState(348)

  const handleLeftResize = useCallback((delta: number) => {
    setLeftWidth(w => Math.min(LEFT_MAX, Math.max(LEFT_MIN, w + delta)))
  }, [])

  const handleRightResize = useCallback((delta: number) => {
    setRightWidth(w => Math.min(RIGHT_MAX, Math.max(RIGHT_MIN, w - delta)))
  }, [])

  return (
    <div
      style={{
        height: '100vh',
        background: 'var(--color-bg-primary)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* ── Graph — fills full viewport as persistent background ── */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
        <GraphPanel />
      </div>

      {/* ── Floating UI shell — pointer-events:none so clicks fall through to graph ── */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          pointerEvents: 'none',
        }}
      >
        {/* TopBar float */}
        <motion.div
          initial={{ y: -60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={PANEL_SPRING}
          style={{
            margin: '12px 12px 0',
            flexShrink: 0,
            pointerEvents: 'auto',
            ...glassPanelStyle,
          }}
        >
          <TopBar />
        </motion.div>

        {/* Main content row */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>

          {/* Left panel — File tree */}
          <motion.div
            initial={{ x: -leftWidth, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={PANEL_SPRING}
            style={{
              width: leftWidth,
              minWidth: leftWidth,
              margin: '8px 0 12px 12px',
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              pointerEvents: 'auto',
              ...glassPanelStyle,
            }}
          >
            <FileTree />
          </motion.div>

          {/* Left resize handle */}
          <div style={{ pointerEvents: 'auto', flexShrink: 0 }}>
            <ResizeHandle onResize={handleLeftResize} />
          </div>

          {/* Center — transparent spacer (graph shows through); overlays float here */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              position: 'relative',
              margin: '8px 0 12px 0',
            }}
          >
            {/* Document viewer overlay */}
            {centerTab === 'document' && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={OVERLAY_TRANSITION}
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  pointerEvents: 'auto',
                  ...glassPanelStyle,
                }}
              >
                <DocViewer />
              </motion.div>
            )}

            {/* Converter editor overlay */}
            {centerTab === 'editor' && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={OVERLAY_TRANSITION}
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  pointerEvents: 'auto',
                  ...glassPanelStyle,
                }}
              >
                <ConverterEditor />
              </motion.div>
            )}
          </div>

          {/* Right resize handle */}
          <div style={{ pointerEvents: 'auto', flexShrink: 0 }}>
            <ResizeHandle onResize={handleRightResize} />
          </div>

          {/* Right panel — Chat */}
          <motion.div
            initial={{ x: rightWidth, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={PANEL_SPRING}
            style={{
              width: rightWidth,
              minWidth: rightWidth,
              margin: '8px 12px 12px 0',
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              pointerEvents: 'auto',
              ...glassPanelStyle,
            }}
          >
            <ChatPanel />
          </motion.div>
        </div>
      </div>

      {/* Settings panel overlay (manages its own z-index) */}
      <SettingsPanel />
    </div>
  )
}
