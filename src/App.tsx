import { useEffect } from 'react'
import { useUIStore } from '@/stores/uiStore'
import LaunchPage from '@/components/launch/LaunchPage'
import MainLayout from '@/components/layout/MainLayout'

export default function App() {
  const { appState, theme, panelOpacity, setAppState } = useUIStore()

  // Apply theme to document root
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Sync panel opacity CSS variable so all panels update instantly
  useEffect(() => {
    document.documentElement.style.setProperty('--panel-opacity', panelOpacity.toString())
  }, [panelOpacity])

  return appState === 'launch'
    ? <LaunchPage onComplete={() => setAppState('main')} />
    : <MainLayout />
}
