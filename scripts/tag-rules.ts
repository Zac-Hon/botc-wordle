import type { AbilityTag } from '../src/game/types.js'

/**
 * Keyword heuristics for deriving ability tags from official ability text.
 *
 * These are a FIRST DRAFT only. The build script prints a full report and
 * every result is overridable in data/tag-overrides.json, which is the
 * authority. Never "fix" a character by bending a rule here -- that silently
 * reclassifies every other character the rule touches. Add an override.
 */
const RULES: { tag: AbilityTag; patterns: RegExp[] }[] = [
  {
    tag: 'information',
    patterns: [
      /\byou (?:start knowing|know|learn)\b/i,
      /\byou are told\b/i,
      /\bshow(?:n|s)?\b/i,
      /\bfind(?:s)? out\b/i,
      /\byou see\b/i,
      /\bhow many\b/i,
      /\bwhich\b.*\bcharacter\b/i,
      /\bthe Storyteller (?:tells|shows|points)\b/i,
    ],
  },
  {
    tag: 'protection',
    patterns: [
      /\bsafe\b/i,
      /\bprotect(?:ed|s)?\b/i,
      /\b(?:can ?not|cannot|can't|do(?:es)?n't) die\b/i,
      /\bimmune\b/i,
      /\bsurviv(?:e|es)\b/i,
    ],
  },
  {
    tag: 'killing',
    patterns: [
      /\byou kill\b/i,
      /\bthey die\b/i,
      /\bthat player dies\b/i,
      /\bchoose a player: (?:they|that player) dies\b/i,
      /\bkills?\b/i,
      /\bdies? tonight\b/i,
    ],
  },
  {
    tag: 'misinformation',
    patterns: [
      /\bdrunk\b/i,
      /\bpoison(?:ed|s)?\b/i,
      /\bregisters?\b/i,
      /\bmight register\b/i,
      /\bmalfunction/i,
      /\bfalse\b/i,
      /\bwrong\b/i,
      /\bmad\b/i,
    ],
  },
  {
    tag: 'voting-social',
    patterns: [
      /\bvotes?\b/i,
      /\bnominat(?:e|es|ed|ion)\b/i,
      /\bexecut(?:e|es|ed|ion)\b/i,
      /\bstand(?:s)? down\b/i,
    ],
  },
  {
    tag: 'death-triggered',
    patterns: [
      /\b(?:when|if) you (?:die|died|are executed)\b/i,
      /\bupon (?:your )?death\b/i,
      /\bwhen you are killed\b/i,
      /\bif you are dead\b/i,
    ],
  },
  {
    tag: 'ability-granting',
    patterns: [
      /\byou have (?:a|all|the)\b.*\babilit(?:y|ies)\b/i,
      /\byou gain\b/i,
      /\bthey (?:gain|regain)\b/i,
      /\bbecomes? (?:a|an|the)\b.*\b(?:character|Townsfolk|Outsider|Minion|Demon)\b/i,
      /\bchanges? character\b/i,
      /\bhas? no ability\b/i,
      /\bgets? \d+ bluffs?\b/i,
      /\bresurrect/i,
    ],
  },
  {
    tag: 'self-targeting',
    patterns: [
      /\byourself\b/i,
      /\byou become\b/i,
      /\byou are (?:the|a|an)\b/i,
      /\byou think\b/i,
    ],
  },
]

/**
 * Removes phrases that EXCLUDE the self, before any keyword matching.
 *
 * "Each night, choose a player (not yourself)" contains the word "yourself" and
 * means precisely the opposite of self-targeting. Matching the bare keyword
 * tagged eight characters, the Butler and the Monk among them, with the inverse
 * of what their ability actually says. Genuine self-reference such as the Imp's
 * "if you kill yourself this way" is left untouched.
 */
function stripSelfExclusions(ability: string): string {
  return ability
    .replace(/\((?:not|other than|except)\s+yourself[^)]*\)/gi, '')
    .replace(/\b(?:not|other than|except|but not)\s+yourself\b/gi, '')
}

/**
 * Derive draft tags from ability text. Storyteller characters bypass this.
 *
 * `affectsSetup` comes from the official `setup` flag rather than the text. It
 * lives in the tag column because only ~11% of characters have it -- far too
 * rare to justify a clue column of its own (measured: it left 89% of the pool
 * standing) but a signal players know well for the famous cases like the Baron.
 */
export function deriveTags(ability: string, affectsSetup: boolean): AbilityTag[] {
  const text = stripSelfExclusions(ability)
  const hits = RULES.filter((r) => r.patterns.some((p) => p.test(text))).map((r) => r.tag)
  if (affectsSetup) hits.push('setup-modifier')
  return hits.length > 0 ? hits : ['no-ability']
}
