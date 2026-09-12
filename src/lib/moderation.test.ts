import { describe, expect, it } from 'vitest'
import { checkPronouns, checkText, normaliseForModeration } from './moderation'

const ok = (s: string) => checkText(s).ok

describe('moderation', () => {
  /**
   * The Scunthorpe problem. These are the cases that make a filter hated, so
   * they are the ones worth pinning down hardest. Every one of these is a real
   * word or place that contains a blocked sequence.
   */
  describe('does not punish innocent words', () => {
    const innocent = [
      'Japan', 'japanese', 'JapanFan', 'japan_2026',
      'Scunthorpe', 'Penistone', 'Clitheroe', 'Cockermouth',
      'analysis', 'Analyst', 'canal', 'banal',
      'Assassin', 'assess', 'classic', 'compass', 'embassy', 'glasses',
      'cocktail', 'cockpit', 'peacock', 'Hitchcock',
      'button', 'buttress', 'titanic', 'shiitake',
      'therapist', 'niggardly', 'snigger', 'Dickinson',
      'hello', 'shell', 'Damsel',
    ]
    for (const word of innocent) {
      it(`allows "${word}"`, () => {
        expect(ok(word)).toBe(true)
      })
    }
  })

  describe('allows ordinary usernames', () => {
    for (const name of ['N8WLD', 'nathan', 'clocktower_fan', 'Imp-Lover', 'xX_Slayer_Xx', 'a1b2c3']) {
      it(`allows "${name}"`, () => {
        expect(ok(name)).toBe(true)
      })
    }
  })

  describe('blocks slurs used as a standalone name', () => {
    for (const name of ['jap', 'Jap', 'paki', 'retard', 'nazi', 'cunt', 'fag']) {
      it(`blocks "${name}"`, () => {
        expect(ok(name)).toBe(false)
      })
    }
  })

  describe('blocks slurs inside a name', () => {
    for (const name of ['nigger', 'a_nigga_here', 'faggot123', 'xXfaggotXx']) {
      it(`blocks "${name}"`, () => {
        expect(ok(name)).toBe(false)
      })
    }
  })

  describe('sees through common evasions', () => {
    for (const name of ['n1gger', 'N1GG3R', 'n-i-g-g-e-r', 'niiigger', 'f4gg0t', 'j@p']) {
      it(`blocks "${name}"`, () => {
        expect(ok(name)).toBe(false)
      })
    }
  })

  it('catches a standalone slur separated by punctuation', () => {
    expect(ok('big_jap_guy')).toBe(false)
    expect(ok('cool.nazi.dude')).toBe(false)
  })

  it('does not quote the offending term back at the user', () => {
    const result = checkText('nigger')
    expect(result.ok).toBe(false)
    expect(result.reason?.toLowerCase()).not.toContain('nigg')
  })

  it('allows empty input, which is the caller’s business', () => {
    expect(ok('')).toBe(true)
    expect(ok('   ')).toBe(true)
  })

  describe('normalisation', () => {
    it('folds case, leetspeak, separators and accents', () => {
      expect(normaliseForModeration('N1_G-G3R')).toBe('nigger')
      expect(normaliseForModeration('Café')).toBe('cafe')
    })

    it('collapses runs of three or more', () => {
      expect(normaliseForModeration('niiiice')).toBe('niice')
    })
  })
})

describe('pronouns', () => {
  it('accepts the common forms', () => {
    for (const p of ['he/him', 'she/her', 'they/them', 'he/they', 'any', 'ask me', "she/they"]) {
      expect(checkPronouns(p).ok, p).toBe(true)
    }
  })

  it('accepts empty, since pronouns are optional', () => {
    expect(checkPronouns('').ok).toBe(true)
  })

  it('rejects anything too long to be pronouns', () => {
    expect(checkPronouns('a'.repeat(25)).ok).toBe(false)
  })

  it('rejects digits and symbols that suggest it is not really pronouns', () => {
    expect(checkPronouns('he/him420').ok).toBe(false)
    expect(checkPronouns('<script>').ok).toBe(false)
  })

  it('applies the same language check', () => {
    expect(checkPronouns('nazi/nazis').ok).toBe(false)
  })
})
