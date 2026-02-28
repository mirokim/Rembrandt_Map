// ── Speaker / Director types ──────────────────────────────────────────────────

export type SpeakerId =
  | 'chief_director'
  | 'art_director'
  | 'plan_director'
  | 'level_director'
  | 'prog_director'
  | 'unknown'   // Phase 6: vault 파일에서 speaker 미지정 시 폴백

/** The 5 actual director personas (excludes the 'unknown' fallback). */
export type DirectorId = Exclude<SpeakerId, 'unknown'>

// ── Document model ────────────────────────────────────────────────────────────

export interface DocSection {
  /** Unique ID — also serves as wiki-link target slug */
  id: string
  heading: string
  body: string
  /** List of [[slug]] references found in this section's body */
  wikiLinks: string[]
}

export interface MockDocument {
  id: string
  filename: string
  speaker: SpeakerId
  date: string
  tags: string[]
  /** Top-level [[wiki-link]] references in frontmatter */
  links: string[]
  sections: DocSection[]
  /** Full markdown string including YAML frontmatter (for FrontmatterBlock display) */
  rawContent: string
}

// ── Graph types ───────────────────────────────────────────────────────────────

export interface GraphNode {
  id: string
  docId: string
  speaker: SpeakerId
  /** Truncated section heading for display */
  label: string
  /** Folder path relative to vault root (for folder color mode) */
  folderPath?: string
  /** Tags from frontmatter (for tag color mode) */
  tags?: string[]
  // d3-force mutable position fields
  x?: number
  y?: number
  z?: number
  vx?: number
  vy?: number
  vz?: number
  fx?: number | null
  fy?: number | null
  fz?: number | null
}

export interface GraphLink {
  source: string | GraphNode
  target: string | GraphNode
  strength?: number
}

export interface PhysicsParams {
  /** Center attraction force — range 0.0–1.0, default 0.05 */
  centerForce: number
  /** Node repulsion (charge) — range -1000–0, default -300 */
  charge: number
  /** Link attraction strength — range 0.0–2.0, default 0.5 */
  linkStrength: number
  /** Base link distance in px — range 20–300, default 80 */
  linkDistance: number
}

// ── Attachment types (Feature 4) ──────────────────────────────────────────────

/**
 * A file attached to a chat message.
 * - type 'image': dataUrl is a base64 data URL (e.g. "data:image/png;base64,...")
 * - type 'text':  dataUrl holds the raw UTF-8 text content
 */
export interface Attachment {
  id: string
  name: string
  type: 'image' | 'text'
  mimeType: string
  dataUrl: string
  size: number
}

// ── Chat types ────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string
  persona: SpeakerId
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  /** True while the assistant is still streaming tokens into this message */
  streaming?: boolean
  /** Files attached to this message (images for vision, text for context injection) */
  attachments?: Attachment[]
}

// ── Vault types (Phase 6) ─────────────────────────────────────────────────────

/** A raw file read from the filesystem vault */
export interface VaultFile {
  relativePath: string   // 볼트 루트 기준 (예: "subdir/note.md")
  absolutePath: string
  content: string        // UTF-8
  mtime?: number         // 파일 수정 타임스탬프 (ms)
}

/**
 * A parsed markdown document loaded from the vault.
 * Structurally identical to MockDocument so both can be used interchangeably.
 * speaker may be 'unknown' if frontmatter is missing/invalid.
 */
export interface LoadedDocument {
  id: string
  filename: string
  /** Folder path relative to vault root (e.g. "Onion Flow"). Empty string for root-level files. */
  folderPath: string
  /** Absolute filesystem path (for save/rename/delete operations) */
  absolutePath: string
  speaker: SpeakerId
  date: string
  /** File last-modified timestamp (ms) — from filesystem stat */
  mtime?: number
  tags: string[]
  links: string[]
  sections: DocSection[]
  rawContent: string
}

// ── Backend / RAG types (Phase 1-3) ──────────────────────────────────────────

/** A document chunk prepared for ChromaDB indexing */
export interface BackendChunk {
  doc_id: string
  filename: string
  section_id: string
  heading: string
  speaker: string
  content: string
  tags: string[]
}

/** A single result from vector similarity search */
export interface SearchResult {
  doc_id: string
  filename: string
  section_id: string | null
  heading: string | null
  speaker: string
  content: string
  score: number   // 0.0–1.0 (higher = more relevant)
  tags: string[]
}

// ── Debate / Discussion types ─────────────────────────────────────────────────

export type DiscussionMode = 'roundRobin' | 'freeDiscussion' | 'roleAssignment' | 'battle'
export type DebateStatus = 'idle' | 'running' | 'paused' | 'completed' | 'stopped'

export interface RoleConfig {
  provider: string
  role: string
}

export interface ReferenceFile {
  id: string
  filename: string
  mimeType: string
  size: number
  dataUrl: string
}

export interface DiscussionConfig {
  mode: DiscussionMode
  topic: string
  maxRounds: number
  participants: string[]
  roles: RoleConfig[]
  judgeProvider?: string
  referenceText: string
  useReference: boolean
  referenceFiles: ReferenceFile[]
  pacing: { mode: 'auto' | 'manual'; autoDelaySeconds: number }
}

export interface DiscussionMessage {
  id: string
  /** 'user' or a ProviderId ('anthropic' | 'openai' | 'gemini' | 'grok') */
  provider: string
  content: string
  round: number
  timestamp: number
  error?: string
  messageType?: 'judge-evaluation'
  roleName?: string
  files?: ReferenceFile[]
}

export interface DebateCallbacks {
  onMessage: (msg: DiscussionMessage) => void
  onStatusChange: (status: DebateStatus) => void
  onRoundChange: (round: number, turnIndex: number) => void
  onLoadingChange: (provider: string | null) => void
  onCountdownTick: (seconds: number) => void
  waitForNextTurn: () => Promise<void>
  getStatus: () => DebateStatus
  getMessages: () => DiscussionMessage[]
}

// ── UI types ──────────────────────────────────────────────────────────────────

export type ThemeId = 'dark' | 'oled' | 'white'
export type GraphMode = '3d' | '2d'
export type CenterTab = 'graph' | 'document' | 'editor'
export type AppState = 'launch' | 'main'
export type NodeColorMode = 'document' | 'auto' | 'speaker' | 'folder' | 'tag' | 'topic'
