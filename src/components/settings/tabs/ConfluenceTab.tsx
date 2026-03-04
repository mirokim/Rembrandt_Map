/**
 * ConfluenceTab — Import Confluence pages into the vault.
 *
 * Pipeline:
 *   1. Fetch pages (date-filtered, hard min 2025-01-01)
 *   2. Convert HTML → Markdown (confluenceToMarkdown.ts)
 *   3. Download image attachments per page
 *   4. Save MD files to vault
 *   5. Run Python refinement scripts (audit_and_fix, enhance_wikilinks, gen_index)
 *   6. Claude Haiku per-file quality review
 */

import { useState, useRef } from 'react'
import { useSettingsStore, getApiKey } from '@/stores/settingsStore'
import { useVaultStore } from '@/stores/vaultStore'
import { pageToVaultMarkdown, toStem, type ConfluencePage, type VaultPage } from '@/lib/confluenceToMarkdown'
import { streamCompletion } from '@/services/providers/anthropic'

// ── Type-safe preload API ──────────────────────────────────────────────────────

declare const confluenceAPI: {
  fetchPages: (config: {
    baseUrl: string; email: string; apiToken: string; spaceKey: string
    dateFrom?: string; dateTo?: string
    authType?: string; bypassSSL?: boolean
  }) => Promise<ConfluencePage[]>
  savePages: (
    vaultPath: string,
    targetFolder: string,
    pages: { filename: string; content: string }[],
  ) => Promise<{ saved: number; targetDir: string; activeDir: string; files: string[] }>
  downloadAttachments: (
    config: { baseUrl: string; authType: string; email: string; apiToken: string; bypassSSL?: boolean },
    vaultPath: string,
    targetFolder: string,
    pageId: string,
  ) => Promise<{ downloaded: number; files: string[] }>
  runScript: (
    scriptName: string,
    args: string[],
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>
  rollback: (
    files: string[],
    dirs: string[],
  ) => Promise<{ deleted: number; errors: string[] }>
  readAppFile: (relativePath: string) => Promise<string | null>
}

// ── URL parser ────────────────────────────────────────────────────────────────

function parseConfluenceUrl(raw: string): {
  baseUrl: string; spaceKey: string; authType: 'cloud' | 'server_pat' | 'server_basic'
} | null {
  try {
    const url = new URL(raw.trim())
    const base = `${url.protocol}//${url.host}`
    const isCloud = url.hostname.endsWith('atlassian.net')
    const authType = isCloud ? 'cloud' : 'server_pat'
    // /display/{SPACE_KEY}/… (Server/DC classic URL)
    let m = url.pathname.match(/\/display\/([A-Z0-9_-]+)/i)
    if (m) return { baseUrl: base, spaceKey: m[1].toUpperCase(), authType }
    // /wiki/spaces/{SPACE_KEY}/… (Cloud & newer Server)
    m = url.pathname.match(/\/wiki\/spaces\/([A-Z0-9_-]+)/i)
    if (m) return { baseUrl: base, spaceKey: m[1].toUpperCase(), authType }
    // /wiki/display/{SPACE_KEY}/… (some Server installations)
    m = url.pathname.match(/\/wiki\/display\/([A-Z0-9_-]+)/i)
    if (m) return { baseUrl: base, spaceKey: m[1].toUpperCase(), authType }
    return null
  } catch { return null }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const HARD_MIN_DATE = '2025-01-01'
const HAIKU_MODEL = 'claude-haiku-4-5-20251001'
const PYTHON_SCRIPTS = ['audit_and_fix.py', 'enhance_wikilinks.py', 'gen_index.py']

function getDateStamp(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loadManualContext(): Promise<string> {
  try {
    const api = (window as any).confluenceAPI
    if (!api?.readAppFile) return ''
    const text = await api.readAppFile('manual/Graph_RAG_데이터_정제_매뉴얼_v3.0.md')
    return text ? text.slice(0, 3000) : ''  // 3K로 줄여 레이트리밋 방지
  } catch { return '' }
}

interface FileIssue { filename: string; issues: string; archive?: boolean }

const ARCHIVE_CRITERIA = `
## 아카이브(.archive/) 이동 권장 기준 (매뉴얼 3.2)
다음 중 하나라도 해당하면 첫 줄에 반드시 "🗄 아카이브 권장:" 으로 시작하세요:
- 6개월 이상 된 스펙·설계 문서 중 이미 변경된 내용이 명확한 것
- 폐기된 기획안 또는 취소된 기능 문서
- 리팩토링·재설계 이전의 구 아키텍처 문서
- 개인별 주간/월간 업무보고 원본 (통합본이 별도 존재하는 경우)
해당 없으면 아카이브 언급 불필요.
`.trim()

async function fixFileWithClaude(
  content: string,
  issues: string,
  apiKey: string,
): Promise<string | null> {
  const sysPrompt = [
    '당신은 마크다운 파일 교정 전문가입니다.',
    '검수 결과에 나열된 문제점만 수정하고, 수정된 전체 파일 내용을 원시 마크다운으로 출력하세요.',
    '코드블록(```)으로 감싸지 말고, 설명 없이 파일 내용만 출력.',
  ].join('\n')
  const userMsg = `## 검수 결과 (수정 필요 사항)\n${issues}\n\n## 현재 파일 내용\n${content.slice(0, 6000)}`
  let result = ''
  try {
    await streamCompletion(apiKey, HAIKU_MODEL, sysPrompt, [{ role: 'user', content: userMsg }],
      (chunk: string) => { result += chunk })
    return result.trim() || null
  } catch { return null }
}

async function reviewFileWithClaude(
  page: VaultPage,
  manualCtx: string,
  apiKey: string,
): Promise<FileIssue> {
  const sysPrompt = manualCtx
    ? `당신은 Graph RAG 데이터 품질 검수자입니다.\n아래는 정제 매뉴얼입니다:\n\n${manualCtx}\n\n${ARCHIVE_CRITERIA}\n\n위 매뉴얼 기준으로 마크다운 문서를 검수하고, 문제점만 간략히 한국어로 나열하세요. 문제 없으면 "✅ 이상 없음" 출력.`
    : `당신은 Graph RAG 데이터 품질 검수자입니다.\n${ARCHIVE_CRITERIA}\n\n마크다운 문서의 구조적 문제(Frontmatter 누락, 헤딩 없음, 빈 섹션 등)를 찾아 간략히 나열하세요. 문제 없으면 "✅ 이상 없음" 출력.`

  const userMsg = `파일: ${page.filename}\n\n${page.content.slice(0, 4000)}`

  let result = ''
  try {
    await streamCompletion(apiKey, HAIKU_MODEL, sysPrompt, [{ role: 'user', content: userMsg }],
      (chunk: string) => { result += chunk })
  } catch (e) {
    result = `검수 오류: ${e instanceof Error ? e.message : String(e)}`
  }
  const trimmed = result.trim() || '✅ 이상 없음'
  return { filename: page.filename, issues: trimmed, archive: trimmed.startsWith('🗄') }
}

// ── FieldRow ──────────────────────────────────────────────────────────────────

function FieldRow({
  label, value, onChange, placeholder, type = 'text', minDate,
}: {
  label: string; value: string; onChange: (v: string) => void
  placeholder?: string; type?: string; minDate?: string
}) {
  const [visible, setVisible] = useState(false)
  const isPassword = type === 'password'
  return (
    <div className="flex items-center gap-2">
      <div className="shrink-0 text-[11px] font-medium" style={{ color: 'var(--color-text-secondary)', minWidth: 100 }}>
        {label}
      </div>
      <div className="flex-1 relative">
        <input
          type={isPassword ? (visible ? 'text' : 'password') : type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          min={minDate}
          autoComplete="off"
          spellCheck={false}
          className="w-full text-xs rounded px-2 py-1.5 font-mono"
          style={{
            background: 'var(--color-bg-surface)',
            color: 'var(--color-text-primary)',
            border: '1px solid var(--color-border)',
            outline: 'none',
            paddingRight: isPassword ? 40 : undefined,
          }}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setVisible(v => !v)}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] px-1"
            style={{ color: 'var(--color-text-muted)' }}
            tabIndex={-1}
          >
            {visible ? '숨김' : '보기'}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ConvertedFile {
  filename: string
  title: string
  type: string
  date: string
}

type ImportStatus =
  | 'idle' | 'fetching' | 'converting' | 'images'
  | 'saving' | 'scripts' | 'reviewing' | 'done' | 'error'

const STATUS_LABEL: Partial<Record<ImportStatus, string>> = {
  fetching:   '1/6 페이지 불러오는 중…',
  converting: '2/6 마크다운 변환 중…',
  images:     '3/6 이미지 다운로드 중…',
  saving:     '4/6 볼트에 저장 중…',
  scripts:    '5/6 Python 스크립트 실행 중…',
  reviewing:  '6/6 Claude Haiku 품질 검수 중…',
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ConfluenceTab() {
  const { confluenceConfig, setConfluenceConfig } = useSettingsStore()
  const vaultPath = useVaultStore(s => s.vaultPath)

  const [status, setStatus] = useState<ImportStatus>('idle')
  const [log, setLog] = useState<string[]>([])
  const [reviews, setReviews] = useState<FileIssue[]>([])
  const [convertedFiles, setConvertedFiles] = useState<ConvertedFile[]>([])
  const [pageCount, setPageCount] = useState(0)
  const [reviewProgress, setReviewProgress] = useState({ done: 0, total: 0 })
  const [urlInput, setUrlInput] = useState('')
  const [urlError, setUrlError] = useState('')
  const [skipImages, setSkipImages] = useState(false)
  const [resultTab, setResultTab] = useState<'files' | 'review'>('files')
  // Rollback tracking
  const [savedFilePaths, setSavedFilePaths] = useState<string[]>([])
  const [savedDirs, setSavedDirs] = useState<string[]>([])
  const [rollbackStatus, setRollbackStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const cancelledRef = useRef(false)
  const activeDirRef = useRef('')   // set after save step; e.g. vault/active_20260304
  const archiveDirRef = useRef('')  // e.g. vault/archive_20260304

  const [autoFixStatus, setAutoFixStatus] = useState<'idle' | 'running' | 'done'>('idle')
  const [fixProgress, setFixProgress] = useState({ done: 0, total: 0 })
  const [fixedFiles, setFixedFiles] = useState<{ filename: string; ok: boolean }[]>([])
  const [archiveMoveStatus, setArchiveMoveStatus] = useState<'idle' | 'running' | 'done'>('idle')
  const [movedToArchive, setMovedToArchive] = useState(0)

  const addLog = (msg: string) => setLog(prev => [...prev, msg])

  const cfg = confluenceConfig
  const hasAnthropicKey = Boolean(getApiKey('anthropic'))
  const dateWarn = cfg.dateFrom && cfg.dateFrom < HARD_MIN_DATE

  const isRunning = !['idle', 'done', 'error'].includes(status)

  const canImport =
    typeof confluenceAPI !== 'undefined' &&
    Boolean(cfg.baseUrl && cfg.email && cfg.apiToken && cfg.spaceKey && vaultPath)

  const handleCancel = () => {
    cancelledRef.current = true
    addLog('⏹ 중지 요청 — 현재 단계 완료 후 중단됩니다…')
  }

  const handleImport = async () => {
    if (!canImport || isRunning) return
    cancelledRef.current = false

    setStatus('fetching')
    setLog([])
    setReviews([])
    setConvertedFiles([])
    setSavedFilePaths([])
    setSavedDirs([])
    setRollbackStatus('idle')
    setPageCount(0)
    setReviewProgress({ done: 0, total: 0 })
    setAutoFixStatus('idle')
    setFixedFiles([])
    setArchiveMoveStatus('idle')
    setMovedToArchive(0)

    const stamp = getDateStamp()
    const targetFolder = `active_${stamp}`  // e.g. active_20260304
    archiveDirRef.current = vaultPath + `/archive_${stamp}`

    try {
      // ── 1. Fetch pages ───────────────────────────────────────────────────────
      const effectiveDateFrom = (!cfg.dateFrom || cfg.dateFrom < HARD_MIN_DATE)
        ? HARD_MIN_DATE : cfg.dateFrom

      addLog(`📡 Confluence 연결: ${cfg.baseUrl}`)
      addLog(`   Space: ${cfg.spaceKey} | 기간: ${effectiveDateFrom} ~ ${cfg.dateTo || '현재'}`)
      if (cfg.dateFrom && cfg.dateFrom < HARD_MIN_DATE)
        addLog(`   ⚠ 시작일이 ${HARD_MIN_DATE}보다 이전 → ${HARD_MIN_DATE}로 자동 조정`)

      const pages: ConfluencePage[] = await confluenceAPI.fetchPages({
        baseUrl: cfg.baseUrl,
        email: cfg.email,
        apiToken: cfg.apiToken,
        spaceKey: cfg.spaceKey,
        dateFrom: effectiveDateFrom,
        dateTo: cfg.dateTo || undefined,
        authType: cfg.authType,
        bypassSSL: cfg.bypassSSL,
      })

      if (pages.length === 0) {
        addLog('ℹ 가져올 페이지가 없습니다 (날짜 범위 또는 스페이스 확인)')
        setStatus('done')
        return
      }
      addLog(`✅ ${pages.length}개 페이지 수신`)
      setPageCount(pages.length)
      if (cancelledRef.current) { addLog('⏹ 중지됨'); setStatus('error'); return }

      // ── 2. Convert HTML → Markdown ───────────────────────────────────────────
      setStatus('converting')
      addLog('🔄 마크다운 변환 중…')
      // Build title→stem map so ac:link wikilinks resolve correctly
      const titleStemMap = new Map<string, string>(pages.map(p => [p.title, toStem(p.title, p.id)]))
      const pagesWithUrl = pages.map(p => ({ ...p, _baseUrl: cfg.baseUrl }))
      const converted: VaultPage[] = pagesWithUrl.map(p => pageToVaultMarkdown(p, titleStemMap))
      addLog(`✅ ${converted.length}개 파일 변환 완료`)
      if (cancelledRef.current) { addLog('⏹ 중지됨'); setStatus('error'); return }

      // Record converted file metadata for display
      setConvertedFiles(converted.map(p => {
        const fmType  = p.content.match(/^type:\s*(.+)$/m)?.[1]?.trim() ?? ''
        const fmDate  = p.content.match(/^date:\s*(.+)$/m)?.[1]?.trim() ?? ''
        const fmTitle = p.content.match(/^title:\s*(.+)$/m)?.[1]?.trim() ?? p.stem
        return { filename: p.filename, title: fmTitle, type: fmType, date: fmDate }
      }))

      // ── 3. Download image attachments ────────────────────────────────────────
      setStatus('images')
      let totalImages = 0
      const attachmentFilePaths: string[] = []
      if (!skipImages) {
        addLog(`🖼 이미지 첨부파일 다운로드 중 (${pages.length}개 페이지)…`)
        for (const page of pages) {
          try {
            const r = await confluenceAPI.downloadAttachments(
              { baseUrl: cfg.baseUrl, authType: cfg.authType, email: cfg.email, apiToken: cfg.apiToken, bypassSSL: cfg.bypassSSL },
              vaultPath!,
              targetFolder,
              page.id,
            )
            totalImages += r.downloaded
            attachmentFilePaths.push(...(r.files ?? []))
          } catch { /* 이미지 실패는 무시하고 계속 */ }
        }
        addLog(`✅ 이미지 ${totalImages}개 다운로드 완료`)
      } else {
        addLog('⏭ 이미지 다운로드 건너뜀')
      }
      if (cancelledRef.current) { addLog('⏹ 중지됨'); setStatus('error'); return }

      // ── 4. Save MD files ─────────────────────────────────────────────────────
      setStatus('saving')
      addLog(`💾 볼트에 저장: ${vaultPath}/${targetFolder}/  (아카이브→ archive_${stamp})`)
      const saveResult = await confluenceAPI.savePages(
        vaultPath!,
        targetFolder,
        converted.map(p => ({ filename: p.filename, content: p.content })),
      )
      addLog(`✅ ${saveResult.saved}개 파일 저장 → ${saveResult.activeDir}`)
      activeDirRef.current = saveResult.activeDir
      // Track all written files (MD + images) for rollback
      setSavedFilePaths([...(saveResult.files ?? []), ...attachmentFilePaths])
      setSavedDirs([saveResult.targetDir])
      if (cancelledRef.current) { addLog('⏹ 중지됨 (저장은 완료됨, 롤백 가능)'); setStatus('done'); return }

      // ── 5. Python refinement scripts ─────────────────────────────────────────
      setStatus('scripts')
      addLog('🐍 Python 정제 스크립트 실행 중…')
      // Scripts: audit_and_fix.py <active_dir> --vault <vault_root>
      const scriptArgs = [saveResult.activeDir, '--vault', vaultPath!]
      for (const script of PYTHON_SCRIPTS) {
        try {
          addLog(`   실행: ${script}`)
          const r = await confluenceAPI.runScript(script, scriptArgs)
          if (r.exitCode === 0) {
            const lines = r.stdout.trim().split('\n').slice(0, 5)
            lines.forEach(l => l && addLog(`     ${l}`))
          } else {
            addLog(`   ⚠ ${script} 오류 (exit ${r.exitCode}): ${r.stderr.slice(0, 200)}`)
          }
        } catch (e) {
          addLog(`   ⚠ ${script} 실패: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      addLog('✅ 스크립트 실행 완료')

      // ── 6. Claude Haiku per-file quality review ──────────────────────────────
      setStatus('reviewing')
      const apiKey = getApiKey('anthropic')
      if (apiKey) {
        addLog(`🤖 Claude Haiku 품질 검수 (${converted.length}개 파일)…`)
        const manualCtx = await loadManualContext()
        if (manualCtx) addLog('   정제 매뉴얼 v3.0 로드됨')

        setReviewProgress({ done: 0, total: converted.length })
        const issues: FileIssue[] = new Array(converted.length)
        let done = 0
        const BATCH = 2  // 2개씩 병렬 — 50k TPM 레이트리밋 방지
        for (let i = 0; i < converted.length; i += BATCH) {
          if (cancelledRef.current) break
          const batch = converted.slice(i, i + BATCH)
          const results = await Promise.all(
            batch.map(p => reviewFileWithClaude(p, manualCtx, apiKey))
          )
          results.forEach((r, j) => { issues[i + j] = r })
          done = Math.min(i + BATCH, converted.length)
          setReviewProgress({ done, total: converted.length })
          // 배치 사이 1.5초 딜레이 — 레이트리밋 방지
          if (done < converted.length) await new Promise(r => setTimeout(r, 1500))
        }
        const validIssues = issues.filter(Boolean)
        setReviews(validIssues)

        const problemCount = validIssues.filter(r => !r.issues.startsWith('✅')).length
        const archiveCount = validIssues.filter(r => r.archive).length
        addLog(`✅ 검수 완료 — 문제: ${problemCount}개, 아카이브 권장: ${archiveCount}개 / 총 ${validIssues.length}개`)
      } else {
        addLog('⏭ Anthropic API 키 없음 → 품질 검수 건너뜀')
      }

      addLog('🎉 가져오기 완료! 볼트를 다시 로드하면 반영됩니다.')
      setStatus('done')

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      addLog(`❌ 오류: ${msg}`)
      setStatus('error')
    }
  }

  const handleAutoFix = async () => {
    const apiKey = getApiKey('anthropic')
    if (!apiKey || !activeDirRef.current) return

    const problemReviews = reviews.filter(r => !r.issues.startsWith('✅') && !r.archive)
    if (problemReviews.length === 0) return

    setAutoFixStatus('running')
    setFixProgress({ done: 0, total: problemReviews.length })
    setFixedFiles([])

    const vaultAPI = (window as any).vaultAPI as {
      readFile: (path: string) => Promise<string | null>
      saveFile: (path: string, content: string) => Promise<void>
    }

    const results: { filename: string; ok: boolean }[] = []
    for (let i = 0; i < problemReviews.length; i++) {
      const r = problemReviews[i]
      const filePath = activeDirRef.current + '/' + r.filename
      try {
        const content = await vaultAPI.readFile(filePath)
        if (!content) { results.push({ filename: r.filename, ok: false }); continue }
        const fixed = await fixFileWithClaude(content, r.issues, apiKey)
        if (fixed) {
          await vaultAPI.saveFile(filePath, fixed)
          results.push({ filename: r.filename, ok: true })
        } else {
          results.push({ filename: r.filename, ok: false })
        }
      } catch {
        results.push({ filename: r.filename, ok: false })
      }
      setFixProgress({ done: i + 1, total: problemReviews.length })
      if (i < problemReviews.length - 1) await new Promise(res => setTimeout(res, 1500))
    }
    setFixedFiles(results)
    setAutoFixStatus('done')
  }

  const handleMoveToArchive = async () => {
    const archiveReviews = reviews.filter(r => r.archive)
    if (archiveReviews.length === 0 || !activeDirRef.current || !archiveDirRef.current) return

    setArchiveMoveStatus('running')
    const vaultAPI = (window as any).vaultAPI as {
      moveFile: (absolutePath: string, destFolderPath: string) => Promise<{ success: boolean; newPath: string }>
    }
    let moved = 0
    for (const r of archiveReviews) {
      try {
        const src = activeDirRef.current + '/' + r.filename
        await vaultAPI.moveFile(src, archiveDirRef.current)
        moved++
      } catch { /* 이동 실패는 건너뜀 */ }
    }
    setMovedToArchive(moved)
    setArchiveMoveStatus('done')
  }

  const handleRollback = async () => {
    if (savedFilePaths.length === 0) return
    setRollbackStatus('running')
    addLog(`♻ 롤백 시작 — ${savedFilePaths.length}개 파일 삭제 중…`)
    try {
      const r = await confluenceAPI.rollback(savedFilePaths, savedDirs)
      addLog(`✅ 롤백 완료 — ${r.deleted}개 파일 삭제됨`)
      if (r.errors.length > 0) {
        addLog(`⚠ 일부 실패 (권한 문제 또는 파일 잠금):`)
        r.errors.forEach(e => addLog(`   • ${e}`))
        setRollbackStatus('error')
      } else {
        setRollbackStatus('done')
      }
      setSavedFilePaths([])
      setConvertedFiles([])
      setReviews([])
      setStatus('idle')
    } catch (e) {
      addLog(`❌ 롤백 오류: ${e instanceof Error ? e.message : String(e)}`)
      setRollbackStatus('error')
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-5">

      {/* Description */}
      <section>
        <p className="text-xs" style={{ color: 'var(--color-text-muted)', lineHeight: 1.7 }}>
          Confluence REST API에서 페이지를 가져와 정제 매뉴얼 v3.0 기준으로 변환·저장합니다.
          Claude Haiku가 각 파일을 검수합니다.
        </p>
      </section>

      <div style={{ borderTop: '1px solid var(--color-border)' }} />

      {/* Connection */}
      <section>
        <h3 className="text-xs font-semibold mb-3" style={{ color: 'var(--color-text-secondary)' }}>
          Confluence 연결 정보
        </h3>

        {/* URL auto-parse */}
        <div className="flex flex-col gap-1 mb-4 p-2.5 rounded" style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium shrink-0" style={{ color: 'var(--color-text-muted)' }}>🔗 Confluence 페이지 URL</span>
            <span className="text-[9px]" style={{ color: 'var(--color-text-muted)' }}>붙여넣으면 자동으로 서버·스페이스 설정</span>
          </div>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={urlInput}
              onChange={e => { setUrlInput(e.target.value); setUrlError('') }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const parsed = parseConfluenceUrl(urlInput)
                  if (parsed) {
                    setConfluenceConfig({ baseUrl: parsed.baseUrl, spaceKey: parsed.spaceKey, authType: parsed.authType })
                    setUrlError('')
                    setUrlInput('')
                  } else {
                    setUrlError('URL에서 스페이스 키를 찾을 수 없습니다')
                  }
                }
              }}
              placeholder="https://wiki.company.com/display/SPACEKEY/PageTitle"
              className="flex-1 text-[11px] rounded px-2 py-1.5 font-mono"
              style={{ background: 'var(--color-bg-base)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border)', outline: 'none' }}
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => {
                const parsed = parseConfluenceUrl(urlInput)
                if (parsed) {
                  setConfluenceConfig({ baseUrl: parsed.baseUrl, spaceKey: parsed.spaceKey, authType: parsed.authType })
                  setUrlError('')
                  setUrlInput('')
                } else {
                  setUrlError('URL에서 스페이스 키를 찾을 수 없습니다')
                }
              }}
              disabled={!urlInput.trim()}
              className="text-[11px] px-2.5 py-1.5 rounded disabled:opacity-40"
              style={{ background: 'var(--color-accent)', color: '#fff', border: 'none', whiteSpace: 'nowrap' }}
            >
              자동 설정
            </button>
          </div>
          {urlError && <p className="text-[10px]" style={{ color: '#f87171' }}>{urlError}</p>}
        </div>

        {/* Auth type selector */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[11px] font-medium shrink-0" style={{ color: 'var(--color-text-secondary)', minWidth: 100 }}>인증 방식</span>
          <div className="flex gap-1 flex-1">
            {([
              { id: 'cloud',        label: 'Cloud (API 토큰)',  desc: 'Atlassian Cloud — 이메일 + API 토큰' },
              { id: 'server_pat',   label: 'Server PAT',        desc: 'Data Center/Server — Personal Access Token' },
              { id: 'server_basic', label: 'Server Basic',      desc: 'Data Center/Server — 사용자명 + 비밀번호' },
            ] as const).map(opt => (
              <button
                key={opt.id}
                onClick={() => setConfluenceConfig({ authType: opt.id })}
                title={opt.desc}
                className="text-[10px] px-2 py-1 rounded transition-colors"
                style={{
                  background: cfg.authType === opt.id ? 'var(--color-accent)' : 'var(--color-bg-hover)',
                  color: cfg.authType === opt.id ? '#fff' : 'var(--color-text-muted)',
                  border: '1px solid var(--color-border)',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <FieldRow label="Base URL"  value={cfg.baseUrl}  onChange={v => setConfluenceConfig({ baseUrl: v })}
            placeholder={cfg.authType === 'cloud' ? 'https://yourcompany.atlassian.net' : 'https://confluence.company.com'} />
          <FieldRow label="Space Key" value={cfg.spaceKey} onChange={v => setConfluenceConfig({ spaceKey: v })} placeholder="DEV" />
          {cfg.authType !== 'server_pat' && (
            <FieldRow
              label={cfg.authType === 'server_basic' ? '사용자명' : '이메일'}
              value={cfg.email}
              onChange={v => setConfluenceConfig({ email: v })}
              placeholder={cfg.authType === 'server_basic' ? 'username' : 'you@company.com'}
            />
          )}
          <FieldRow
            label={cfg.authType === 'server_pat' ? 'PAT 토큰' : cfg.authType === 'server_basic' ? '비밀번호' : 'API 토큰'}
            value={cfg.apiToken}
            onChange={v => setConfluenceConfig({ apiToken: v })}
            type="password"
            placeholder={cfg.authType === 'server_pat' ? 'Personal Access Token' : cfg.authType === 'server_basic' ? '비밀번호' : 'Atlassian API 토큰'}
          />
        </div>

        {/* Auth type hints */}
        <div className="mt-2 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
          {cfg.authType === 'cloud' && '프로필 → 계정 관리 → 보안 → API 토큰 관리에서 발급'}
          {cfg.authType === 'server_pat' && 'Confluence → 프로필 → Settings → Personal Access Tokens에서 발급. 이메일 불필요.'}
          {cfg.authType === 'server_basic' && '사내 Confluence 사용자명과 비밀번호 직접 입력. PAT 방식 권장.'}
        </div>

        {/* SSL bypass toggle */}
        <div className="flex items-center gap-2 mt-3 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          <input
            id="bypass-ssl"
            type="checkbox"
            checked={cfg.bypassSSL}
            onChange={e => setConfluenceConfig({ bypassSSL: e.target.checked })}
            className="w-3 h-3"
          />
          <label htmlFor="bypass-ssl" className="text-[11px] cursor-pointer" style={{ color: 'var(--color-text-secondary)' }}>
            SSL 인증서 검증 우회 <span style={{ color: 'var(--color-text-muted)' }}>(사내 CA 인증서 / 자체 서명 인증서 사용 시)</span>
          </label>
        </div>
        {cfg.bypassSSL && (
          <p className="text-[10px] mt-1" style={{ color: '#f59e0b' }}>
            ⚠ SSL 검증을 비활성화하면 중간자 공격에 취약할 수 있습니다. 사내망에서만 사용하세요.
          </p>
        )}
      </section>

      <div style={{ borderTop: '1px solid var(--color-border)' }} />

      {/* Date range */}
      <section>
        <h3 className="text-xs font-semibold mb-3" style={{ color: 'var(--color-text-secondary)' }}>
          날짜 범위 <span className="text-[10px] font-normal" style={{ color: 'var(--color-text-muted)' }}>(하드 최소: {HARD_MIN_DATE})</span>
        </h3>
        <div className="flex flex-col gap-2.5">
          <FieldRow
            label="시작일"
            type="date"
            value={cfg.dateFrom}
            onChange={v => setConfluenceConfig({ dateFrom: v })}
            minDate={HARD_MIN_DATE}
          />
          <FieldRow
            label="종료일"
            type="date"
            value={cfg.dateTo}
            onChange={v => setConfluenceConfig({ dateTo: v })}
          />
        </div>
        {dateWarn && (
          <p className="text-[10px] mt-1.5" style={{ color: '#f59e0b' }}>
            ⚠ 시작일이 {HARD_MIN_DATE} 이전입니다. 실제 가져오기 시 {HARD_MIN_DATE}로 자동 조정됩니다.
          </p>
        )}
        <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
          종료일 비워두면 오늘까지 전부 가져옵니다.
        </p>
      </section>

      <div style={{ borderTop: '1px solid var(--color-border)' }} />

      {/* Save settings */}
      <section>
        <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>
          저장 설정
        </h3>
        {/* Auto folder info */}
        <div className="rounded p-2.5 text-[11px]" style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <span style={{ color: 'var(--color-text-muted)' }}>일반 문서 →</span>
              <code className="font-mono" style={{ color: 'var(--color-accent)' }}>active_YYYYMMDD/</code>
            </div>
            <div className="flex items-center gap-1.5">
              <span style={{ color: 'var(--color-text-muted)' }}>아카이브 →</span>
              <code className="font-mono" style={{ color: '#60a5fa' }}>archive_YYYYMMDD/</code>
            </div>
            <div className="flex items-center gap-1.5">
              <span style={{ color: 'var(--color-text-muted)' }}>이미지 →</span>
              <code className="font-mono" style={{ color: 'var(--color-text-muted)' }}>attachments/</code>
              <span style={{ color: 'var(--color-text-muted)' }}>(볼트 루트)</span>
            </div>
          </div>
          {vaultPath && (
            <p className="mt-1.5 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
              볼트: {vaultPath}
            </p>
          )}
        </div>

        {/* Skip images toggle */}
        <div className="flex items-center gap-2 mt-3">
          <input
            id="skip-images"
            type="checkbox"
            checked={skipImages}
            onChange={e => setSkipImages(e.target.checked)}
            className="w-3 h-3"
          />
          <label htmlFor="skip-images" className="text-[11px] cursor-pointer" style={{ color: 'var(--color-text-secondary)' }}>
            이미지 첨부파일 다운로드 건너뜀
          </label>
        </div>
      </section>

      <div style={{ borderTop: '1px solid var(--color-border)' }} />

      {/* AI review note */}
      <section>
        <div className="flex items-start gap-2 rounded p-2.5" style={{ background: hasAnthropicKey ? 'var(--color-bg-surface)' : '#f8717122', border: '1px solid var(--color-border)' }}>
          <span className="text-base leading-none mt-0.5">{hasAnthropicKey ? '🤖' : '⚠'}</span>
          <div>
            <p className="text-[11px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              {hasAnthropicKey ? 'Claude Haiku 품질 검수 활성' : 'Anthropic API 키 없음'}
            </p>
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              {hasAnthropicKey
                ? `각 파일을 ${HAIKU_MODEL} 모델로 검수합니다. 정제 매뉴얼 v3.0 기준.`
                : 'AI 설정에서 Anthropic API 키를 등록하면 품질 검수가 활성화됩니다.'}
            </p>
          </div>
        </div>
      </section>

      <div style={{ borderTop: '1px solid var(--color-border)' }} />

      {/* Import button + log */}
      <section>
        {!vaultPath && (
          <p className="text-xs mb-3" style={{ color: '#f87171' }}>
            ⚠ 볼트를 먼저 열어야 가져오기를 실행할 수 있습니다.
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={handleImport}
            disabled={!canImport || isRunning}
            className="text-xs px-4 py-2 rounded font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: status === 'done' ? '#22c55e22' : status === 'error' ? '#f8717122' : 'var(--color-accent)',
              color: status === 'done' ? '#22c55e' : status === 'error' ? '#f87171' : '#fff',
              border: ['done', 'error'].includes(status) ? '1px solid currentColor' : 'none',
            }}
          >
            {isRunning
              ? (STATUS_LABEL[status] ?? '처리 중…')
              : status === 'done'
                ? `✅ 완료 (${pageCount}개)`
                : status === 'error'
                  ? '❌ 재시도'
                  : '⬇ Confluence에서 가져오기'}
          </button>

          {/* Cancel button — shown while running */}
          {isRunning && (
            <button
              onClick={handleCancel}
              disabled={cancelledRef.current}
              className="text-xs px-3 py-2 rounded transition-colors disabled:opacity-40"
              style={{ background: '#f8717122', color: '#f87171', border: '1px solid #f8717144' }}
            >
              ⏹ 중지
            </button>
          )}

          {status === 'reviewing' && reviewProgress.total > 0 && (
            <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
              {reviewProgress.done}/{reviewProgress.total} 검수 중…
            </span>
          )}

          {/* Rollback button — only shown after successful save */}
          {savedFilePaths.length > 0 && rollbackStatus !== 'done' && (
            <button
              onClick={handleRollback}
              disabled={rollbackStatus === 'running' || isRunning}
              className="text-xs px-3 py-2 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: '#f8717122',
                color: '#f87171',
                border: '1px solid #f8717144',
              }}
              title={`저장된 ${savedFilePaths.length}개 파일을 모두 삭제합니다`}
            >
              {rollbackStatus === 'running' ? '롤백 중…' : `↩ 롤백 (${savedFilePaths.length}개 파일 삭제)`}
            </button>
          )}
          {rollbackStatus === 'done' && (
            <span className="text-[11px]" style={{ color: '#22c55e' }}>↩ 롤백 완료</span>
          )}
        </div>

        {/* Log panel */}
        {log.length > 0 && (
          <div
            className="mt-3 rounded p-3 text-[11px] font-mono flex flex-col gap-0.5 overflow-y-auto"
            style={{
              background: 'var(--color-bg-surface)',
              border: '1px solid var(--color-border)',
              maxHeight: 150,
              color: 'var(--color-text-secondary)',
            }}
          >
            {log.map((line, i) => (
              <div key={i} style={{ color: line.startsWith('❌') ? '#f87171' : line.startsWith('⚠') ? '#f59e0b' : undefined }}>
                {line}
              </div>
            ))}
          </div>
        )}

        {/* Results panel — converted files + Claude review */}
        {(convertedFiles.length > 0 || reviews.length > 0) && (
          <div className="mt-4">
            {/* Tab bar */}
            <div className="flex gap-0 mb-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
              {([
                { id: 'files',  label: `전환된 파일 (${convertedFiles.length})` },
                { id: 'review', label: reviews.length > 0
                  ? (() => {
                      const problems = reviews.filter(r => !r.issues.startsWith('✅') && !r.archive).length
                      const archives = reviews.filter(r => r.archive).length
                      const parts = []
                      if (problems > 0) parts.push(`${problems}개 문제`)
                      if (archives > 0) parts.push(`🗄 ${archives}개 아카이브`)
                      return `검수 결과 (${parts.join(', ') || '이상 없음'})`
                    })()
                  : '검수 결과 (대기)' },
              ] as const).map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setResultTab(tab.id)}
                  className="px-3 py-1.5 text-[11px] transition-colors"
                  style={{
                    color: resultTab === tab.id ? 'var(--color-accent)' : 'var(--color-text-muted)',
                    borderBottom: resultTab === tab.id ? '2px solid var(--color-accent)' : '2px solid transparent',
                    marginBottom: -1,
                    fontWeight: resultTab === tab.id ? 600 : 400,
                    background: 'none',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Files tab */}
            {resultTab === 'files' && convertedFiles.length > 0 && (
              <div
                className="overflow-y-auto rounded-b"
                style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', borderTop: 'none', maxHeight: 200 }}
              >
                {/* Header row */}
                <div
                  className="grid px-3 py-1.5 text-[10px] font-semibold sticky top-0"
                  style={{
                    gridTemplateColumns: '1fr 80px 90px',
                    color: 'var(--color-text-muted)',
                    background: 'var(--color-bg-surface)',
                    borderBottom: '1px solid var(--color-border)',
                  }}
                >
                  <span>파일명</span>
                  <span>유형</span>
                  <span>날짜</span>
                </div>
                {convertedFiles.map((f, i) => (
                  <div
                    key={i}
                    className="grid px-3 py-1.5 text-[11px]"
                    style={{
                      gridTemplateColumns: '1fr 80px 90px',
                      borderBottom: i < convertedFiles.length - 1 ? '1px solid var(--color-border)' : undefined,
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    <span className="truncate font-mono" style={{ fontSize: 10 }} title={f.filename}>
                      {f.title || f.filename}
                    </span>
                    <span style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>{f.type || '—'}</span>
                    <span style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>{f.date || '—'}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Review tab */}
            {resultTab === 'review' && (
              <div style={{ border: '1px solid var(--color-border)', borderTop: 'none', borderRadius: '0 0 4px 4px' }}>
                {/* Action toolbar — auto-fix + archive move */}
                {(() => {
                  const fixable = reviews.filter(r => !r.issues.startsWith('✅') && !r.archive)
                  const archivable = reviews.filter(r => r.archive)
                  if (fixable.length === 0 && archivable.length === 0) return null
                  const fixedOk = fixedFiles.filter(f => f.ok).length
                  const anyRunning = autoFixStatus === 'running' || archiveMoveStatus === 'running' || isRunning
                  return (
                    <div
                      className="flex items-center gap-2 px-3 py-2 flex-wrap"
                      style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-base)' }}
                    >
                      {fixable.length > 0 && hasAnthropicKey && activeDirRef.current && (
                        <button
                          onClick={handleAutoFix}
                          disabled={anyRunning}
                          className="text-[11px] px-3 py-1 rounded font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{ background: 'var(--color-accent)', color: '#fff', border: 'none', whiteSpace: 'nowrap' }}
                        >
                          {autoFixStatus === 'running'
                            ? `🔧 수정 중… (${fixProgress.done}/${fixProgress.total})`
                            : autoFixStatus === 'done'
                              ? `✅ 수정 완료 (${fixedOk}/${fixedFiles.length}개)`
                              : `🔧 자동 수정 (${fixable.length}개)`}
                        </button>
                      )}
                      {archivable.length > 0 && activeDirRef.current && (
                        <button
                          onClick={handleMoveToArchive}
                          disabled={anyRunning || archiveMoveStatus === 'done'}
                          className="text-[11px] px-3 py-1 rounded font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{ background: '#3b82f622', color: '#60a5fa', border: '1px solid #3b82f644', whiteSpace: 'nowrap' }}
                        >
                          {archiveMoveStatus === 'running'
                            ? '📦 이동 중…'
                            : archiveMoveStatus === 'done'
                              ? `✅ 아카이브 이동 완료 (${movedToArchive}개)`
                              : `📦 archive_${getDateStamp()}/ 로 이동 (${archivable.length}개)`}
                        </button>
                      )}
                    </div>
                  )
                })()}

                {/* Fix results inline indicator */}
                {fixedFiles.length > 0 && (
                  <div className="flex flex-wrap gap-1 px-3 py-1.5" style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-base)' }}>
                    {fixedFiles.map((f, i) => (
                      <span
                        key={i}
                        className="text-[9px] px-1.5 py-0.5 rounded font-mono"
                        style={{ background: f.ok ? '#22c55e22' : '#f8717122', color: f.ok ? '#22c55e' : '#f87171' }}
                        title={f.filename}
                      >
                        {f.ok ? '✓' : '✗'} {f.filename.replace(/\.md$/, '')}
                      </span>
                    ))}
                  </div>
                )}

                <div className="overflow-y-auto" style={{ maxHeight: 200, background: 'var(--color-bg-surface)' }}>
                  {reviews.length === 0 ? (
                    <div className="px-3 py-4 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                      {status === 'reviewing' ? `검수 중… (${reviewProgress.done}/${reviewProgress.total})` : '검수 결과 없음'}
                    </div>
                  ) : (
                    reviews.map((r, i) => {
                      const fixResult = fixedFiles.find(f => f.filename === r.filename)
                      return (
                        <div
                          key={i}
                          className="px-3 py-2 text-[11px]"
                          style={{
                            borderBottom: i < reviews.length - 1 ? '1px solid var(--color-border)' : undefined,
                            background: r.archive ? '#3b82f608' : r.issues.startsWith('✅') ? undefined : '#f8717108',
                          }}
                        >
                          <div className="flex items-center gap-1.5 font-mono mb-1" style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>
                            <span>{r.filename}</span>
                            {fixResult && (
                              <span style={{ color: fixResult.ok ? '#22c55e' : '#f87171', fontSize: 9 }}>
                                {fixResult.ok ? '(수정됨)' : '(수정 실패)'}
                              </span>
                            )}
                          </div>
                          <div style={{
                            color: r.archive ? '#60a5fa' : r.issues.startsWith('✅') ? '#22c55e' : '#f87171',
                            lineHeight: 1.5, whiteSpace: 'pre-wrap',
                          }}>
                            {r.issues}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

    </div>
  )
}
