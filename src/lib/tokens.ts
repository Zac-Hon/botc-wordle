import { BY_ID } from '../data/pools'
import type { Character } from '../game/types'

/**
 * URL for a character's token art.
 *
 * This one line was written out in thirteen places, each repeating both the
 * base-URL prefix and the assumption that the file is named after the id. The
 * fallback matters: a session can name a character that is no longer in the
 * build (a renamed id, a pool the data pipeline dropped), and the id-derived
 * filename is right often enough to be worth trying before showing nothing.
 */
export function tokenSrc(source: string | Character | null | undefined): string | undefined {
  if (!source) return undefined
  const image =
    typeof source === 'string' ? (BY_ID.get(source)?.image ?? `${source}.webp`) : source.image
  return tokenSrcFromFile(image)
}

/**
 * Same URL, from a filename rather than an id.
 *
 * Kept separate rather than sniffing the string for a .webp suffix, because the
 * two inputs look alike and guessing wrong turns an id into a broken image with
 * no error anywhere. Server-supplied filenames (the Versus icon round) and
 * Character.image come through here.
 */
export function tokenSrcFromFile(image: string | null | undefined): string | undefined {
  if (!image) return undefined
  return `${import.meta.env.BASE_URL}tokens/${image}`
}
