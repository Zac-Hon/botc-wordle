/**
 * Cross-checks every derived character attribute against the official source.
 *
 *   npm run audit:data
 *
 * build-characters.ts only fails on things it cannot classify at all. This goes
 * further and re-derives each attribute independently, then compares. It exists
 * because two silent data faults shipped: ability tags inverted by "(not
 * yourself)", and every character who wakes only on later nights reporting no
 * night order at all. Both looked fine in the build output.
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Character } from '../src/game/types.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(ROOT, 'node_modules', '.cache', 'botc-data')
const NIGHT_META = new Set(['dusk', 'dawn', 'minioninfo', 'demoninfo'])

interface RawRole {
  id: string
  name: string
  team: string
  edition: string
  ability?: string
  flavor?: string
  setup?: boolean
  reminders?: string[]
  remindersGlobal?: string[]
}

const problems: string[] = []
const notes: string[] = []
const fail = (msg: string) => problems.push(msg)
const note = (msg: string) => notes.push(msg)

async function main() {
  const characters: Character[] = JSON.parse(
    await readFile(join(ROOT, 'src', 'data', 'characters.json'), 'utf8'),
  )
  const roles: RawRole[] = JSON.parse(await readFile(join(CACHE, 'roles.json'), 'utf8'))
  const nights: { firstNight: string[]; otherNight: string[] } = JSON.parse(
    await readFile(join(CACHE, 'nightsheet.json'), 'utf8'),
  )
  const jinxes: { id: string; jinx: { id: string }[] }[] = JSON.parse(
    await readFile(join(CACHE, 'jinxes.json'), 'utf8'),
  )

  const byId = new Map(characters.map((c) => [c.id, c]))
  const rawById = new Map(roles.map((r) => [r.id, r]))
  const first = nights.firstNight.filter((x) => !NIGHT_META.has(x))
  const other = nights.otherNight.filter((x) => !NIGHT_META.has(x))
  const inFirst = new Set(first)
  const inOther = new Set(other)

  // --- Coverage -------------------------------------------------------------
  if (characters.length !== roles.length) {
    fail(`character count ${characters.length} does not match source ${roles.length}`)
  }
  for (const r of roles) if (!byId.has(r.id)) fail(`${r.name} (${r.id}) missing from build output`)
  for (const c of characters) if (!rawById.has(c.id)) fail(`${c.name} (${c.id}) not in source data`)

  const ids = new Set<string>()
  const names = new Set<string>()
  for (const c of characters) {
    if (ids.has(c.id)) fail(`duplicate id: ${c.id}`)
    if (names.has(c.name)) fail(`duplicate name: ${c.name}`)
    ids.add(c.id)
    names.add(c.name)
  }

  for (const c of characters) {
    const raw = rawById.get(c.id)
    if (!raw) continue
    const where = `${c.name} (${c.id})`

    // --- Straight copies ----------------------------------------------------
    if (c.name !== raw.name) fail(`${where}: name differs from source (${raw.name})`)
    if (c.ability !== (raw.ability ?? '')) fail(`${where}: ability text differs from source`)
    if (c.affectsSetup !== (raw.setup === true)) fail(`${where}: affectsSetup differs from source`)

    // --- Night behaviour ----------------------------------------------------
    const f = inFirst.has(c.id)
    const o = inOther.has(c.id)
    const expectedWake = f && o ? 'both' : f ? 'first' : o ? 'other' : 'never'
    if (c.attrs.wake !== expectedWake) {
      fail(`${where}: wake is "${c.attrs.wake}", sheets say "${expectedWake}"`)
    }

    // The bug that prompted this script: a waking character with no order.
    if (expectedWake === 'never' && c.attrs.nightOrder !== null) {
      fail(`${where}: never wakes but has a night order of ${c.attrs.nightOrder}`)
    }
    if (expectedWake !== 'never' && c.attrs.nightOrder === null) {
      fail(`${where}: wakes (${expectedWake}) but has no night order`)
    }
    if (c.attrs.nightOrder !== null) {
      const n = c.attrs.nightOrder
      if (!Number.isInteger(n) || n < 1 || n > 100) {
        fail(`${where}: night order ${n} outside the 1-100 scale`)
      }
      const sheet = o ? other : first
      const expected = Math.max(1, Math.round(((sheet.indexOf(c.id) + 1) / sheet.length) * 100))
      if (n !== expected) fail(`${where}: night order ${n}, recomputed ${expected}`)
    }

    // --- Reminders ----------------------------------------------------------
    const expectedReminders =
      (raw.reminders?.length ?? 0) + (raw.remindersGlobal?.length ?? 0)
    if (c.attrs.reminders !== expectedReminders) {
      fail(`${where}: reminders ${c.attrs.reminders}, source has ${expectedReminders}`)
    }

    // --- Pools --------------------------------------------------------------
    const storyteller = raw.team === 'fabled' || raw.team === 'loric'
    if (c.pools.isStoryteller !== storyteller) {
      fail(`${where}: isStoryteller ${c.pools.isStoryteller}, team is ${raw.team}`)
    }
    if (c.pools.isTraveller !== (raw.team === 'traveller')) {
      fail(`${where}: isTraveller disagrees with team ${raw.team}`)
    }
    const base3 = ['tb', 'bmr', 'snv'].includes(raw.edition) && !storyteller
    if (c.pools.inBase3 !== base3) fail(`${where}: inBase3 disagrees with edition ${raw.edition}`)
    if (c.pools.inBase3 && c.pools.isExperimental) fail(`${where}: in base 3 AND experimental`)
    if (!c.pools.inBase3 && !c.pools.isExperimental && !c.pools.isStoryteller) {
      fail(`${where}: belongs to no pool`)
    }
    // Storyteller characters must never be reachable from a competitive mode.
    if (storyteller && (c.pools.inBase3 || c.pools.isExperimental)) {
      fail(`${where}: storyteller character is in a competitive pool`)
    }

    // --- Script -------------------------------------------------------------
    if (storyteller && c.attrs.script !== raw.team) {
      fail(`${where}: script "${c.attrs.script}" should follow team "${raw.team}"`)
    }
    if (!storyteller && c.attrs.script === 'fabled') {
      fail(`${where}: non-storyteller carries the fabled script`)
    }

    // --- Tags ---------------------------------------------------------------
    if (c.attrs.tags.length === 0) fail(`${where}: no ability tags at all`)
    if (new Set(c.attrs.tags).size !== c.attrs.tags.length) fail(`${where}: duplicate tags`)
    if (storyteller) {
      if (c.attrs.tags.join() !== 'rules-modifier') {
        fail(`${where}: storyteller should carry only rules-modifier`)
      }
    } else {
      if (c.attrs.tags.includes('rules-modifier')) {
        fail(`${where}: player character tagged rules-modifier`)
      }
      if (c.attrs.tags.includes('no-ability') && (raw.ability ?? '').length > 0) {
        fail(`${where}: tagged no-ability but has ability text`)
      }
      if (c.attrs.tags.includes('setup-modifier') !== (raw.setup === true)) {
        fail(`${where}: setup-modifier tag disagrees with the source setup flag`)
      }
    }
    // The negation fault: "(not yourself)" is the opposite of self-targeting.
    if (
      /\((?:not|other than|except)\s+yourself/i.test(c.ability) &&
      c.attrs.tags.includes('self-targeting') &&
      !/\byou become\b|\byou gain\b/i.test(c.ability)
    ) {
      fail(`${where}: self-targeting, but the ability explicitly excludes itself`)
    }

    // --- Art ----------------------------------------------------------------
    if (c.image !== `${c.id}.webp`) fail(`${where}: unexpected image name ${c.image}`)
    if (!existsSync(join(ROOT, 'public', 'tokens', c.image))) {
      fail(`${where}: token art missing on disk`)
    }
  }

  // --- Jinxes are symmetric ---------------------------------------------------
  const expectedJinx = new Map<string, number>()
  const seen = new Set<string>()
  for (const entry of jinxes) {
    for (const o of entry.jinx) {
      const pair = [entry.id, o.id].sort().join('|')
      if (seen.has(pair)) continue
      seen.add(pair)
      for (const id of [entry.id, o.id]) {
        expectedJinx.set(id, (expectedJinx.get(id) ?? 0) + 1)
      }
    }
  }
  for (const c of characters) {
    const expected = expectedJinx.get(c.id) ?? 0
    if (c.attrs.jinxes !== expected) {
      fail(`${c.name}: jinxes ${c.attrs.jinxes}, source pairs give ${expected}`)
    }
  }
  for (const [id, n] of expectedJinx) {
    if (!byId.has(id)) note(`jinx references unknown character "${id}" (${n} pairs), ignored`)
  }

  // --- Spot checks against the actual game ------------------------------------
  // Hand-written expectations. If the source ever changes shape, these are the
  // ones that will notice.
  const SPOT: Record<string, { team: string; script: string; wake: string; hasOrder: boolean }> = {
    washerwoman: { team: 'townsfolk', script: 'tb', wake: 'first', hasOrder: true },
    imp: { team: 'demon', script: 'tb', wake: 'other', hasOrder: true },
    baron: { team: 'minion', script: 'tb', wake: 'never', hasOrder: false },
    oracle: { team: 'townsfolk', script: 'snv', wake: 'other', hasOrder: true },
    soldier: { team: 'townsfolk', script: 'tb', wake: 'never', hasOrder: false },
    poisoner: { team: 'minion', script: 'tb', wake: 'both', hasOrder: true },
    bureaucrat: { team: 'traveller', script: 'tb', wake: 'both', hasOrder: true },
    djinn: { team: 'fabled', script: 'fabled', wake: 'never', hasOrder: false },
  }
  for (const [id, want] of Object.entries(SPOT)) {
    const c = byId.get(id)
    if (!c) {
      fail(`spot check: ${id} not found`)
      continue
    }
    if (c.attrs.team !== want.team) fail(`spot check ${id}: team ${c.attrs.team}, want ${want.team}`)
    if (c.attrs.script !== want.script) {
      fail(`spot check ${id}: script ${c.attrs.script}, want ${want.script}`)
    }
    if (c.attrs.wake !== want.wake) fail(`spot check ${id}: wake ${c.attrs.wake}, want ${want.wake}`)
    if ((c.attrs.nightOrder !== null) !== want.hasOrder) {
      fail(`spot check ${id}: night order presence wrong (${c.attrs.nightOrder})`)
    }
  }

  // --- Report -----------------------------------------------------------------
  const wakes = characters.filter((c) => c.attrs.wake !== 'never').length
  console.log(`Audited ${characters.length} characters against the official source.`)
  console.log(`  with a night order : ${wakes}`)
  console.log(`  never wake (N/A)   : ${characters.length - wakes}`)
  console.log(`  base 3 / experimental / storyteller : ` +
    `${characters.filter((c) => c.pools.inBase3).length} / ` +
    `${characters.filter((c) => c.pools.isExperimental).length} / ` +
    `${characters.filter((c) => c.pools.isStoryteller).length}`)

  if (notes.length) {
    console.log('\nNotes:')
    notes.forEach((n) => console.log(`  ${n}`))
  }

  if (problems.length) {
    console.error(`\n${problems.length} problem(s):`)
    problems.forEach((p) => console.error(`  ${p}`))
    process.exit(1)
  }
  console.log('\nNo problems found.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
