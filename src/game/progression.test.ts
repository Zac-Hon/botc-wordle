import { describe, expect, it } from 'vitest'
import { ALL_CHARACTERS, BY_ID } from '../data/pools'
import { FRAMES, frameSx, getFrame } from './frames'
import { canMaster, collectionTier, missingModes } from './mastery'
import { tokenSrc, tokenSrcFromFile } from '../lib/tokens'
import type { CollectionEntry } from './useCollection'

function entry(over: Partial<CollectionEntry> = {}): CollectionEntry {
  return {
    character_id: 'washerwoman',
    first_earned_at: '2026-01-01T00:00:00Z',
    earned_count: 1,
    earned_daily: false,
    earned_endless: false,
    earned_pvp: false,
    ...over,
  }
}

const washerwoman = BY_ID.get('washerwoman')!
const storyteller = ALL_CHARACTERS.find((c) => c.pools.isStoryteller)!

describe('collection tiers', () => {
  it('reports nothing for a character never named', () => {
    expect(collectionTier(washerwoman, undefined)).toBe('none')
  })

  it('separates an Endless win from a daily win', () => {
    expect(collectionTier(washerwoman, entry({ earned_endless: true }))).toBe('owned')
    expect(collectionTier(washerwoman, entry({ earned_daily: true }))).toBe('ringed')
  })

  it('needs all three modes for mastery', () => {
    const two = entry({ earned_daily: true, earned_endless: true })
    expect(collectionTier(washerwoman, two)).toBe('ringed')
    expect(collectionTier(washerwoman, { ...two, earned_pvp: true })).toBe('mastered')
  })

  // The important one. record_collection sets earned_daily for a storyteller
  // character on an Endless win, because Endless is the best way it can be
  // earned. If mastery only checked the three flags it would still be out of
  // reach, but a future change to that rule could hand out the top tier for a
  // single win, so the exclusion is asserted directly rather than implied.
  it('never masters a Fabled or Loric character, whatever the flags say', () => {
    expect(canMaster(storyteller)).toBe(false)
    const all = entry({ earned_daily: true, earned_endless: true, earned_pvp: true })
    expect(collectionTier(storyteller, all)).toBe('ringed')
    expect(missingModes(storyteller, all)).toEqual([])
  })

  it('names the modes still outstanding', () => {
    expect(missingModes(washerwoman, entry({ earned_endless: true }))).toEqual(['Daily', 'Versus'])
    expect(missingModes(washerwoman, undefined)).toEqual([])
  })
})

describe('token urls', () => {
  it('resolves a character, an id and a filename to the same url', () => {
    const fromChar = tokenSrc(washerwoman)
    expect(fromChar).toBe(tokenSrc('washerwoman'))
    expect(fromChar).toBe(tokenSrcFromFile('washerwoman.webp'))
    expect(fromChar).toContain('tokens/washerwoman.webp')
  })

  it('falls back to the id for a character the build no longer has', () => {
    // A session can name a character a later data pipeline dropped or renamed.
    // The id-derived filename is right often enough to be worth trying.
    expect(tokenSrc('ghost-of-a-character')).toContain('tokens/ghost-of-a-character.webp')
  })

  it('returns nothing for nothing, rather than a url ending in null', () => {
    expect(tokenSrc(null)).toBeUndefined()
    expect(tokenSrc(undefined)).toBeUndefined()
    expect(tokenSrcFromFile(null)).toBeUndefined()
  })
})

describe('avatar frames', () => {
  it('has unique ids', () => {
    expect(new Set(FRAMES.map((f) => f.id)).size).toBe(FRAMES.length)
  })

  it('draws a ring for a known frame and none for anything else', () => {
    expect(getFrame('candle')?.name).toBe('Candlelight')
    expect(frameSx('candle').borderColor).toBeTruthy()
    // An id the catalogue knows but this build does not must leave the avatar
    // plain rather than throwing, so a deploy lagging a migration is cosmetic.
    expect(getFrame('not-a-frame')).toBeNull()
    expect(frameSx('not-a-frame').borderColor).toBeUndefined()
    expect(frameSx(null).borderColor).toBeUndefined()
  })
})
