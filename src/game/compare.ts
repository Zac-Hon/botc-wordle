import { CLUE_SPEC, type ClueColumn, type ClueResult } from './clueSpec.js'
import type { CharacterAttrs } from './types.js'

/** Which way the answer sits relative to the guess, for numeric columns. */
export type Direction = 'up' | 'down'

export interface ClueCell {
  key: string
  label: string
  shortLabel: string
  result: ClueResult
  /** The guess's own value, which is what the cell displays. */
  value: string | number | null | string[]
  /** Present only on numeric columns when the values differ. */
  direction?: Direction
}

export type ClueRow = ClueCell[]

function compareGroup(guess: unknown, answer: unknown, col: ClueColumn): ClueResult {
  if (guess === answer) return 'match'
  const groups = col.groups ?? {}
  const g = groups[String(guess)]
  const a = groups[String(answer)]
  return g !== undefined && g === a ? 'partial' : 'miss'
}

function compareNumeric(
  guess: unknown,
  answer: unknown,
  col: ClueColumn,
): { result: ClueResult; direction?: Direction } {
  const g = guess as number | null
  const a = answer as number | null

  if (col.nullable && (g === null || a === null)) {
    // Both absent is a genuine shared trait ("neither wakes on the first night").
    // One absent gives no ordering, so there is no arrow to show.
    return { result: g === null && a === null ? 'match' : 'miss' }
  }
  if (g === null || a === null) return { result: 'miss' }

  if (g === a) return { result: 'match' }
  const direction: Direction = a > g ? 'up' : 'down'
  const tolerance = col.tolerance ?? 0
  return { result: Math.abs(g - a) <= tolerance ? 'partial' : 'miss', direction }
}

function compareSet(guess: unknown, answer: unknown): ClueResult {
  const g = (guess as string[]) ?? []
  const a = (answer as string[]) ?? []
  const answerSet = new Set(a)
  const shared = g.filter((t) => answerSet.has(t))
  if (shared.length === g.length && g.length === a.length) return 'match'
  return shared.length > 0 ? 'partial' : 'miss'
}

/**
 * Compares one guess against the answer, producing a cell per clue column.
 *
 * Pure and total: it never throws on unexpected values, it just reports a miss.
 * The plpgsql mirror of this function must agree cell-for-cell; scripts/verify-parity.ts
 * enforces that across thousands of random pairs.
 */
export function compare(guess: CharacterAttrs, answer: CharacterAttrs): ClueRow {
  return CLUE_SPEC.map((col): ClueCell => {
    const g = guess[col.key]
    const a = answer[col.key]

    const base = { key: col.key, label: col.label, shortLabel: col.shortLabel, value: g }

    switch (col.kind) {
      case 'group':
        return { ...base, result: compareGroup(g, a, col) }
      case 'exact':
        return { ...base, result: g === a ? 'match' : 'miss' }
      case 'numeric': {
        const { result, direction } = compareNumeric(g, a, col)
        return direction ? { ...base, result, direction } : { ...base, result }
      }
      case 'set':
        return { ...base, result: compareSet(g, a) }
    }
  })
}

/** True when every column matched, i.e. the guess is the answer. */
export function isSolved(row: ClueRow): boolean {
  return row.every((cell) => cell.result === 'match')
}

/**
 * Fraction of cells that matched, used to settle a PvP round where neither
 * player solved: the closest guess takes the points.
 */
export function matchFraction(row: ClueRow): number {
  const score = row.reduce(
    (sum, cell) => sum + (cell.result === 'match' ? 1 : cell.result === 'partial' ? 0.5 : 0),
    0,
  )
  return score / row.length
}

/** Emoji square for the share grid. */
export function cellEmoji(result: ClueResult): string {
  return result === 'match' ? '🟩' : result === 'partial' ? '🟨' : '⬜'
}
