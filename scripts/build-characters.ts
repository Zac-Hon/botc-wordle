/**
 * Builds src/data/characters.json (and the matching SQL seed) from the official
 * Pandemonium Institute toolmaker data, and downloads token art into public/tokens.
 *
 *   npm run build:data              # uses cached downloads where present
 *   npm run build:data -- --fresh   # re-fetch everything
 *
 * Output is committed, so the app has no runtime dependency on GitHub.
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deriveTags } from './tag-rules.js'
import { CLUE_SPEC } from '../src/game/clueSpec.js'
import type { AbilityTag, Character, CharacterAttrs, Script, Team, Wake } from '../src/game/types.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA_BASE =
  'https://raw.githubusercontent.com/ThePandemoniumInstitute/botc-release/main/resources/data'
const ART_BASE = 'https://release.botc.app/resources/characters'
const CACHE = join(ROOT, 'node_modules', '.cache', 'botc-data')
const TOKENS = join(ROOT, 'public', 'tokens')
const FRESH = process.argv.includes('--fresh')

/** Shape of an entry in the official roles.json. */
interface RawRole {
  id: string
  name: string
  team: Team
  edition: string
  ability?: string
  flavor?: string
  setup?: boolean
  reminders?: string[]
  remindersGlobal?: string[]
}

interface NightSheet {
  firstNight: string[]
  otherNight: string[]
}

interface JinxEntry {
  id: string
  jinx: { id: string; reason: string }[]
}

/**
 * Pseudo-entries on the night sheets that mark storyteller steps rather than a
 * character waking. They must not consume a night-order position.
 */
const NIGHT_META = new Set(['dusk', 'dawn', 'minioninfo', 'demoninfo'])

const SCRIPT_BY_EDITION: Record<string, Script> = {
  tb: 'tb',
  bmr: 'bmr',
  snv: 'snv',
  carousel: 'experimental',
  fabled: 'fabled',
  loric: 'loric',
}

const GOOD_TEAMS: Team[] = ['townsfolk', 'outsider']
const EVIL_TEAMS: Team[] = ['minion', 'demon']
const STORYTELLER_TEAMS: Team[] = ['fabled', 'loric']

async function fetchJson<T>(name: string): Promise<T> {
  await mkdir(CACHE, { recursive: true })
  const cached = join(CACHE, name)
  if (!FRESH && existsSync(cached)) {
    return JSON.parse(await readFile(cached, 'utf8')) as T
  }
  const res = await fetch(`${DATA_BASE}/${name}`)
  if (!res.ok) throw new Error(`Failed to fetch ${name}: HTTP ${res.status}`)
  const text = await res.text()
  await writeFile(cached, text)
  return JSON.parse(text) as T
}

/**
 * Art filenames are suffixed by alignment: _g for good teams, _e for evil, and
 * no suffix for travellers and storyteller characters (whose alignment is not
 * fixed). Folder is the raw edition, not the normalised script.
 */
function artPath(role: RawRole): string {
  if (GOOD_TEAMS.includes(role.team)) return `${role.edition}/${role.id}_g.webp`
  if (EVIL_TEAMS.includes(role.team)) return `${role.edition}/${role.id}_e.webp`
  return `${role.edition}/${role.id}.webp`
}

/** Downloads one token, verifying status -- a 404 here serves a 9KB HTML body. */
async function downloadArt(role: RawRole): Promise<string> {
  const remote = artPath(role)
  const local = join(TOKENS, `${role.id}.webp`)
  if (!FRESH && existsSync(local)) return `${role.id}.webp`

  const res = await fetch(`${ART_BASE}/${remote}`)
  if (!res.ok) {
    throw new Error(`Missing art for ${role.id} (${role.name}): ${remote} -> HTTP ${res.status}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.subarray(0, 4).toString('ascii') !== 'RIFF') {
    throw new Error(`Art for ${role.id} is not a WebP file: ${remote}`)
  }
  await writeFile(local, buf)
  return `${role.id}.webp`
}

/** Runs tasks with bounded concurrency so we do not hammer the CDN. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

function buildNightOrder(sheet: string[]): Map<string, number> {
  const order = new Map<string, number>()
  let position = 0
  for (const id of sheet) {
    if (NIGHT_META.has(id)) continue
    order.set(id, ++position)
  }
  return order
}

function deriveWake(id: string, first: Map<string, number>, other: Map<string, number>): Wake {
  const f = first.has(id)
  const o = other.has(id)
  if (f && o) return 'both'
  if (f) return 'first'
  if (o) return 'other'
  return 'never'
}

/** Jinxes are listed one-way in the source; both characters share the jinx. */
function buildJinxCounts(jinxes: JinxEntry[]): Map<string, number> {
  const counts = new Map<string, number>()
  const bump = (id: string) => counts.set(id, (counts.get(id) ?? 0) + 1)
  const seen = new Set<string>()
  for (const entry of jinxes) {
    for (const other of entry.jinx) {
      const pair = [entry.id, other.id].sort().join('|')
      if (seen.has(pair)) continue
      seen.add(pair)
      bump(entry.id)
      bump(other.id)
    }
  }
  return counts
}

async function main() {
  console.log(FRESH ? 'Building character data (fresh fetch)...' : 'Building character data...')
  await mkdir(TOKENS, { recursive: true })
  await mkdir(join(ROOT, 'src', 'data'), { recursive: true })

  const [roles, nights, jinxes] = await Promise.all([
    fetchJson<RawRole[]>('roles.json'),
    fetchJson<NightSheet>('nightsheet.json'),
    fetchJson<JinxEntry[]>('jinxes.json'),
  ])

  const firstOrder = buildNightOrder(nights.firstNight)
  const otherOrder = buildNightOrder(nights.otherNight)
  const jinxCounts = buildJinxCounts(jinxes)

  const overridesPath = join(ROOT, 'data', 'tag-overrides.json')
  const rawOverrides: Record<string, unknown> = existsSync(overridesPath)
    ? JSON.parse(await readFile(overridesPath, 'utf8'))
    : {}
  // Keys beginning with _ are documentation, not characters.
  const overrides = Object.fromEntries(
    Object.entries(rawOverrides).filter(([k]) => !k.startsWith('_')),
  ) as Record<string, AbilityTag[]>

  const unclassified: { id: string; name: string; reason: string }[] = []

  console.log(`Downloading token art for ${roles.length} characters...`)
  const images = await mapLimit(roles, 8, downloadArt)

  const characters: Character[] = roles.map((role, i) => {
    const script = SCRIPT_BY_EDITION[role.edition]
    if (!script) {
      unclassified.push({
        id: role.id,
        name: role.name,
        reason: `unknown edition "${role.edition}"`,
      })
    }

    const isStoryteller = STORYTELLER_TEAMS.includes(role.team)
    const ability = role.ability ?? ''

    // Storyteller characters modify the game's rules rather than granting a
    // player power, so the ability-tag vocabulary does not apply to them.
    const tags: AbilityTag[] = overrides[role.id]
      ? overrides[role.id]
      : isStoryteller
        ? ['rules-modifier']
        : deriveTags(ability, role.setup === true)

    const attrs: CharacterAttrs = {
      team: role.team,
      // Storyteller characters are keyed by TEAM, not edition: Deus ex Fiasco
      // and Ferryman are team "fabled" but ship in the carousel edition.
      script: isStoryteller ? (role.team as Script) : (script ?? 'experimental'),
      wake: deriveWake(role.id, firstOrder, otherOrder),
      nightOrder: firstOrder.get(role.id) ?? null,
      tags,
      reminders: (role.reminders?.length ?? 0) + (role.remindersGlobal?.length ?? 0),
      jinxes: jinxCounts.get(role.id) ?? 0,
    }

    return {
      id: role.id,
      name: role.name,
      ability,
      flavor: role.flavor ?? '',
      image: images[i],
      affectsSetup: role.setup === true,
      attrs,
      pools: {
        inBase3: ['tb', 'bmr', 'snv'].includes(role.edition) && !isStoryteller,
        isExperimental: role.edition === 'carousel' && !isStoryteller,
        isTraveller: role.team === 'traveller',
        isStoryteller,
      },
    }
  })

  // A character that belongs to no pool would be unreachable in every mode.
  for (const c of characters) {
    const { inBase3, isExperimental, isStoryteller } = c.pools
    if (!inBase3 && !isExperimental && !isStoryteller) {
      unclassified.push({ id: c.id, name: c.name, reason: 'belongs to no answer pool' })
    }
  }

  if (unclassified.length > 0) {
    await writeFile(join(ROOT, 'data', 'unclassified.json'), JSON.stringify(unclassified, null, 2))
    console.error(`\n${unclassified.length} character(s) could not be classified:`)
    unclassified.forEach((u) => console.error(`  - ${u.name} (${u.id}): ${u.reason}`))
    console.error('\nAdd entries to data/tag-overrides.json, then re-run. Refusing to emit data.')
    process.exit(1)
  }

  characters.sort((a, b) => a.name.localeCompare(b.name))
  const json = JSON.stringify(characters, null, 2)
  await writeFile(join(ROOT, 'src', 'data', 'characters.json'), json)

  await writeSeed(characters)

  const hash = createHash('sha256').update(json).digest('hex').slice(0, 16)
  await writeFile(
    join(ROOT, 'src', 'data', 'characters.hash.ts'),
    '// Generated by scripts/build-characters.ts -- do not edit.\n' +
      `export const CHARACTERS_HASH = '${hash}'\n`,
  )

  const count = (pred: (c: Character) => boolean) => characters.filter(pred).length
  const tagTally: Record<string, number> = {}
  characters.forEach((c) => c.attrs.tags.forEach((t) => (tagTally[t] = (tagTally[t] ?? 0) + 1)))

  console.log(`\nWrote ${characters.length} characters (hash ${hash})`)
  console.log(`  Daily Classic pool (base 3):   ${count((c) => c.pools.inBase3)}`)
  console.log(`  Daily Full pool (non-ST):      ${count((c) => !c.pools.isStoryteller)}`)
  console.log(`    of which experimental:       ${count((c) => c.pools.isExperimental)}`)
  console.log(`    of which travellers:         ${count((c) => c.pools.isTraveller)}`)
  console.log(`  Storyteller (Endless opt-in):  ${count((c) => c.pools.isStoryteller)}`)

  console.log('\nAbility tags:')
  Object.entries(tagTally)
    .sort((a, b) => b[1] - a[1])
    .forEach(([t, n]) => console.log(`  ${t.padEnd(16)} ${n}`))
  console.log(`\nOverrides applied: ${Object.keys(overrides).length}`)

  const untagged = characters.filter(
    (c) => c.attrs.tags.includes('no-ability') && !c.pools.isStoryteller,
  )
  if (untagged.length > 0) {
    console.log(`\n${untagged.length} player character(s) fell through to "no-ability":`)
    untagged.forEach((c) => console.log(`  - ${c.name}: ${c.ability.slice(0, 70)}`))
  }
}

const NL = String.fromCharCode(10)

/** Postgres string literal, single quotes doubled. */
const lit = (v: unknown) => `'${JSON.stringify(v).replace(/'/g, "''")}'`

/**
 * Emits the SQL seed from the same in-memory objects as characters.json, so the
 * two cannot drift. Both the character rows and the clue_spec rows come from
 * here -- the plpgsql comparator is generic and reads clue_spec at runtime, so
 * this is what actually configures it.
 */
async function writeSeed(characters: Character[]) {
  const dir = join(ROOT, 'supabase', 'seed')
  await mkdir(dir, { recursive: true })

  const lines: string[] = [
    '-- Generated by scripts/build-characters.ts -- do not edit.',
    '-- Run after 01_schema.sql. Safe to re-run at any time.',
    '',
    'begin;',
    '',
    '-- clue_spec has nothing referencing it, so it is replaced wholesale.',
    'delete from public.clue_spec;',
    'insert into public.clue_spec (key, ordinal, label, short_label, kind, params) values',
  ]

  lines.push(
    CLUE_SPEC.map((col, i) => {
      const params: Record<string, unknown> = {}
      if (col.groups) params.groups = col.groups
      if (col.tolerance !== undefined) params.tolerance = col.tolerance
      if (col.nullable !== undefined) params.nullable = col.nullable
      return `  ('${col.key}', ${i}, '${col.label.replace(/'/g, "''")}', '${col.shortLabel.replace(/'/g, "''")}', '${col.kind}', ${lit(params)}::jsonb)`
    }).join(',' + NL) + ';',
    '',
    '-- Characters are UPSERTED, never cleared.',
    '--',
    '-- This used to delete every row and re-insert, which worked while only',
    '-- daily_puzzles referenced them. Once games existed it began failing on a',
    '-- foreign key from pvp_round_answers, and cascading the delete instead',
    '-- would have thrown away real match history to refresh a name. Upserting',
    '-- leaves every reference intact and no longer disturbs daily_puzzles, so',
    '-- there is nothing to re-seed afterwards.',
    'insert into public.characters (id, name, attrs, pools) values',
  )

  lines.push(
    characters
      .map((c) => `  ('${c.id}', '${c.name.replace(/'/g, "''")}', ${lit(c.attrs)}::jsonb, ${lit(c.pools)}::jsonb)`)
      .join(',' + NL) + ';',
  )

  lines.push(
    'on conflict (id) do update set',
    '  name  = excluded.name,',
    '  attrs = excluded.attrs,',
    '  pools = excluded.pools;',
    '',
    '-- norm_name is added by 05_pvp.sql, so only touch it once that has run.',
    'do $$',
    'begin',
    '  if exists (',
    '    select 1 from information_schema.columns',
    "    where table_schema = 'public' and table_name = 'characters'",
    "      and column_name = 'norm_name'",
    '  ) then',
    '    update public.characters',
    "    set norm_name = lower(regexp_replace(name, '[^A-Za-z0-9]', '', 'g'));",
    '  end if;',
    'end',
    '$$;',
    '',
    '-- Drop anything no longer in the official data, but only where nothing',
    '-- references it. A character that has been played stays, and is reported',
    '-- rather than silently kept or forcibly removed.',
    'do $$',
    'declare',
    '  keep text[] := array[',
    characters.map((c) => `    '${c.id}'`).join(',' + NL),
    '  ];',
    '  stale text[];',
    '  blocked text[];',
    '  fk record;',
    '  n int;',
    '  id text;',
    'begin',
    '  select coalesce(array_agg(c.id), \'{}\') into stale',
    '  from public.characters c where c.id <> all (keep);',
    '',
    '  if array_length(stale, 1) is null then return; end if;',
    '',
    '  blocked := \'{}\';',
    '  foreach id in array stale loop',
    '    -- Walk every foreign key that points at characters(id) rather than',
    '    -- hard-coding the list, so a table added later is covered too.',
    '    for fk in',
    '      select tc.table_name, kcu.column_name',
    '      from information_schema.table_constraints tc',
    '      join information_schema.key_column_usage kcu',
    '        on kcu.constraint_name = tc.constraint_name',
    '      join information_schema.constraint_column_usage ccu',
    '        on ccu.constraint_name = tc.constraint_name',
    "      where tc.constraint_type = 'FOREIGN KEY'",
    "        and ccu.table_name = 'characters' and ccu.column_name = 'id'",
    '    loop',
    '      execute format(\'select count(*) from public.%I where %I = $1\', fk.table_name, fk.column_name)',
    '        into n using id;',
    '      if n > 0 then',
    '        blocked := blocked || id;',
    '        exit;',
    '      end if;',
    '    end loop;',
    '  end loop;',
    '',
    '  delete from public.characters c',
    '  where c.id <> all (keep) and c.id <> all (blocked);',
    '',
    '  if array_length(blocked, 1) > 0 then',
    "    raise notice 'Kept % character(s) no longer in the official data because "
      + "they are referenced by existing games: %', array_length(blocked, 1), blocked;",
    '  end if;',
    'end',
    '$$;',
    '',
    'commit;',
    '',
  )

  await writeFile(join(dir, 'characters.sql'), lines.join(NL))
  console.log(`Wrote supabase/seed/characters.sql (${characters.length} characters, ${CLUE_SPEC.length} clue columns)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
