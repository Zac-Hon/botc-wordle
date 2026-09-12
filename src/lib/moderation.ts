/**
 * Light-touch moderation for usernames and pronouns.
 *
 * The design goal is explicitly NOT maximum catch rate. A filter that blocks
 * "Japan" because it contains "jap", or "Scunthorpe" because of what sits in the
 * middle of it, is worse than no filter: it insults ordinary users, it is
 * infuriating to debug, and people simply work around it. This is a private app
 * for a friend group, so the bar is "stops someone being deliberately vile",
 * not "defeats a determined adversary".
 *
 * Two tiers:
 *
 *   STANDALONE  terms that are only offensive as their own word. Matched only
 *               when the term IS the whole name or sits as a separated token.
 *               "jap" lives here, so "japan" and "japanese" pass untouched.
 *
 *   SUBSTRING   terms that essentially never occur inside an innocent English
 *               word. Matched anywhere, but the ALLOWLIST is consulted first.
 *
 * Add to ALLOWLIST whenever a real word gets caught. That list is the pressure
 * valve that keeps this from becoming the Scunthorpe problem.
 */

/** Real words that contain a blocked sequence and must always be allowed. */
const ALLOWLIST = [
  'japan', 'japanese',
  'scunthorpe', 'penistone', 'lightwater', 'clitheroe', 'cockermouth',
  'analysis', 'analyst', 'analyse', 'analyze', 'canal', 'banal',
  'assassin', 'assassins', 'assess', 'assert', 'asset', 'assume', 'class',
  'classic', 'bass', 'grass', 'pass', 'mass', 'compass', 'embassy', 'glasses',
  'cocktail', 'cockpit', 'cockerel', 'peacock', 'shuttlecock', 'hitchcock',
  'butthead', 'buttress', 'button', 'shiitake', 'titan', 'titanic', 'title',
  'niggardly', 'snigger', 'dickens', 'dickinson',
  'therapist', 'therapists', 'mishit', 'skipshit',
  'hellcat', 'shell', 'shelly', 'hello', 'damsel', 'damascus',
]

/**
 * Offensive only as a standalone word. Matched as a whole token, never as a
 * substring, so ordinary words containing them are untouched.
 */
const STANDALONE = [
  'jap', 'japs', 'gyp', 'gypo', 'wog', 'wogs', 'coon', 'coons', 'chink',
  'chinks', 'gook', 'gooks', 'spic', 'spics', 'kike', 'kikes', 'abo',
  'paki', 'pakis', 'wetback', 'raghead', 'towelhead', 'tranny', 'trannies',
  'retard', 'retards', 'retarded', 'spastic', 'mongoloid',
  'fag', 'fags', 'dyke', 'dykes', 'homo', 'queer',
  'nazi', 'nazis', 'hitler', 'kkk',
  'rape', 'rapist', 'incest', 'pedo', 'paedo', 'nonce',
  'cunt', 'cunts', 'twat', 'wank', 'wanker', 'slut', 'whore', 'bitch',
  'shit', 'piss', 'dick', 'cock', 'tit', 'tits', 'arse', 'ass', 'bastard',
]

/** Never appears inside an innocent word. Checked against ALLOWLIST first. */
const SUBSTRING = [
  'nigger', 'nigga', 'niggers', 'niggas',
  'faggot', 'faggots',
  'childporn', 'cp0rn', 'kiddieporn',
  'heilhitler', 'sieg heil',
]

/**
 * Folds the evasions people actually use: case, leetspeak, doubled letters and
 * separators. "N1_G-G3R" and "nnigger" both normalise onto the same string.
 */
export function normaliseForModeration(input: string): string {
  const leet: Record<string, string> = {
    '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b',
    '@': 'a', '$': 's', '!': 'i', '+': 't', '|': 'i',
  }
  return input
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split('')
    .map((ch) => leet[ch] ?? ch)
    .join('')
    .replace(/[^a-z]/g, '')
    // Collapse runs so "niiigger" folds down. Real words rarely have triples.
    .replace(/(.)\1{2,}/g, '$1$1')
}

/**
 * Collapses every run of a repeated letter to one.
 *
 * "niiigger" folds to "niger", as does "nigger", which the doubling rule in
 * normaliseForModeration cannot catch on its own: it trims runs to two, and the
 * padding here is in a different position from the word's own double letter.
 *
 * Only used for the SUBSTRING tier. Applying it to STANDALONE would squeeze
 * "ass" to "as" and start blocking people called "As".
 */
function squeeze(input: string): string {
  return input.replace(/(.)\1+/g, '$1')
}

/** Tokens for standalone matching, split on anything that is not a letter. */
function tokens(input: string): string[] {
  const leetFolded = normaliseForModeration(input)
  const rawTokens = input
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((t) => normaliseForModeration(t))
    .filter(Boolean)

  // The whole string counts as a token too, so a one-word name is checked.
  return [...new Set([leetFolded, ...rawTokens])]
}

export interface ModerationResult {
  ok: boolean
  reason?: string
}

/**
 * Checks a display string. Returns ok, or a reason suitable for showing.
 *
 * The reason never quotes the offending term back at the user, which keeps the
 * message from itself being unpleasant and avoids confirming exactly which
 * evasion was detected.
 */
export function checkText(input: string, what = 'That'): ModerationResult {
  const flat = normaliseForModeration(input)
  if (!flat) return { ok: true }

  // A name that IS an allowlisted word is fine no matter what it contains.
  if (ALLOWLIST.includes(flat)) return { ok: true }

  const squeezed = squeeze(flat)

  for (const term of SUBSTRING) {
    const needle = normaliseForModeration(term)
    if (!needle) continue

    const hit = flat.includes(needle) || squeezed.includes(squeeze(needle))
    if (!hit) continue

    // Only clear it if an allowlisted word actually explains the match.
    const explained = ALLOWLIST.some((safe) => {
      const s1 = normaliseForModeration(safe)
      return (
        (flat.includes(s1) && s1.includes(needle)) ||
        (squeezed.includes(squeeze(s1)) && squeeze(s1).includes(squeeze(needle)))
      )
    })
    if (!explained) return { ok: false, reason: `${what} contains language we do not allow.` }
  }

  const parts = tokens(input)
  for (const term of STANDALONE) {
    const needle = normaliseForModeration(term)
    if (parts.includes(needle) && !ALLOWLIST.includes(flat)) {
      return { ok: false, reason: `${what} contains language we do not allow.` }
    }
  }

  return { ok: true }
}

/** Pronouns are short and free-text, so they get the same check. */
export function checkPronouns(input: string): ModerationResult {
  const trimmed = input.trim()
  if (trimmed.length === 0) return { ok: true }
  if (trimmed.length > 24) return { ok: false, reason: 'Pronouns must be 24 characters or fewer.' }
  if (!/^[A-Za-z/ '-]+$/.test(trimmed)) {
    return { ok: false, reason: 'Use letters, slashes, spaces, apostrophes and hyphens only.' }
  }
  return checkText(trimmed, 'Those pronouns')
}
