/**
 * Avatar frames: the ring drawn around a player's token wherever they appear.
 *
 * Which frames exist is decided by the database (achievements.grants_frame), so
 * that nobody can wear one they have not earned. How each is drawn is decided
 * here, because it is presentation and has no business in SQL. That split is
 * the same two-engine hazard as the clue comparator, so verify-parity asserts
 * the two sides list exactly the same ids.
 *
 * Pure data and CSS. No images, so a frame costs nothing to load.
 */
export interface Frame {
  id: string
  /** Shown in the picker and on the achievement that grants it. */
  name: string
  /** Ring colour. */
  color: string
  /** Outer glow, or null for a flat ring. */
  glow: string | null
}

export const FRAMES: readonly Frame[] = [
  { id: 'candle', name: 'Candlelight', color: '#c8a951', glow: 'rgba(200,169,81,0.55)' },
  { id: 'ember', name: 'Ember', color: '#a3282c', glow: 'rgba(163,40,44,0.55)' },
  { id: 'moonlight', name: 'Moonlight', color: '#8fa8d8', glow: 'rgba(143,168,216,0.5)' },
  { id: 'verdant', name: 'Verdant', color: '#3f8f4f', glow: 'rgba(63,143,79,0.5)' },
  { id: 'storm', name: 'Storm', color: '#8a6bbf', glow: 'rgba(138,107,191,0.55)' },
] as const

const BY_FRAME_ID = new Map(FRAMES.map((f) => [f.id, f]))

export function getFrame(id: string | null | undefined): Frame | null {
  return id ? (BY_FRAME_ID.get(id) ?? null) : null
}

/**
 * Border and shadow for a frame, ready to spread into an sx prop.
 *
 * An unknown id returns no ring rather than throwing: a frame added to the
 * catalogue before a deploy should leave the avatar plain, not blank the page.
 */
export function frameSx(id: string | null | undefined) {
  const frame = getFrame(id)
  if (!frame) return { border: '2px solid transparent' }
  return {
    border: '2px solid',
    borderColor: frame.color,
    boxShadow: frame.glow ? `0 0 8px ${frame.glow}` : 'none',
  }
}
