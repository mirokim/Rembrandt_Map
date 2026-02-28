import type { SpeakerId } from '@/types'

export interface SpeakerMeta {
  label: string
  /** CSS hex color string */
  color: string
  /** Three.js hex number */
  hex: number
  /** Dark background for folder/chip */
  darkBg: string
  /** Short description */
  role: string
}

export const SPEAKER_CONFIG: Record<SpeakerId, SpeakerMeta> = {
  chief_director: {
    label: 'Chief',
    color: '#9b59b6',
    hex: 0x9b59b6,
    darkBg: '#2d1b42',
    role: '전체 비전 · 방향성 · 부서 조율',
  },
  art_director: {
    label: 'Art',
    color: '#00bcd4',
    hex: 0x00bcd4,
    darkBg: '#003d45',
    role: '비주얼 퀄리티 · 톤앤매너 · 컬러',
  },
  plan_director: {
    label: 'Design',
    color: '#ff9800',
    hex: 0xff9800,
    darkBg: '#3d2000',
    role: '게임플레이 · 시스템 · 일정 · 우선순위',
  },
  level_director: {
    label: 'Level',
    color: '#4caf50',
    hex: 0x4caf50,
    darkBg: '#0d2e0d',
    role: '레벨 플로우 · 시야 유도 · 기믹 · 레이아웃',
  },
  prog_director: {
    label: 'Prog',
    color: '#2196f3',
    hex: 0x2196f3,
    darkBg: '#0d1f3c',
    role: '최적화 · 퍼포먼스 · 안정성 · 기술 구조',
  },
  unknown: {
    label: '?',
    color: '#888888',
    hex: 0x888888,
    darkBg: '#1e1e1e',
    role: '미분류 문서',
  },
}

/** The 5 named director IDs (excludes 'unknown') — use for persona UI */
export const SPEAKER_IDS = [
  'chief_director',
  'art_director',
  'plan_director',
  'level_director',
  'prog_director',
] as const satisfies SpeakerId[]
