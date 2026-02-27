import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function generateId(): string {
  return crypto.randomUUID()
}

/** Slugify a heading string for wiki-link matching */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_가-힣]/g, '')
}

/** Truncate a string to a max length with ellipsis */
export function truncate(text: string, max = 40): string {
  if (text.length <= max) return text
  return text.slice(0, max - 1) + '…'
}

/** Extract [[slug]] references from a markdown string */
export function extractWikiLinks(text: string): string[] {
  const matches = text.match(/\[\[([^\]]+)\]\]/g) ?? []
  return matches.map(m => m.slice(2, -2).trim())
}
