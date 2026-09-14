/**
 * Adds an ordering guard to every numbered SQL file.
 *
 *   node scripts/add-migration-guards.mjs
 *
 * Nineteen functions are defined in more than one numbered file, because later
 * files replace earlier definitions. That makes running an earlier file after a
 * later one silently destructive: re-running 05_pvp.sql today would revert
 * time-weighted scoring, synchronised round starts, single round-trip actions
 * and the ranked-start fix, with no error and no obvious symptom.
 *
 * Each file now records itself in schema_version and refuses to run if a higher
 * numbered file has already been applied. Re-running the whole sequence in order
 * is still fine, which is what "safe to re-run" was always supposed to mean.
 *
 * Idempotent: running this twice does not double up the guards.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const DIR = 'supabase'
const MARK = 'ordering guard'

const files = (await readdir(DIR)).filter((f) => /^\d\d_.*\.sql$/.test(f)).sort()
const changed = []

for (const name of files) {
  const path = join(DIR, name)
  const original = await readFile(path, 'utf8')
  if (original.toLowerCase().includes(MARK)) continue

  const n = Number(name.slice(0, 2))

  // Keep the file's own explanatory header first, then the guard. "Header" is
  // the leading run of comment lines, stopping at the first blank line, so a
  // later section banner is not split from the code it introduces.
  const lines = original.split('\n')
  let i = 0
  while (i < lines.length && lines[i].startsWith('--')) i++

  // A single % is the placeholder plpgsql substitutes v_max into. Doubling it
  // prints a literal percent and leaves the parameter unconsumed, which is an
  // error rather than a cosmetic problem.
  const guard = [
    '',
    '-- Ordering guard: refuses to run if a later migration has already been',
    '-- applied, because that would revert whatever the later file replaced.',
    'create table if not exists public.schema_version (',
    '  n          int primary key,',
    '  applied_at timestamptz not null default now()',
    ');',
    '',
    'do $guard$',
    'declare v_max int;',
    'begin',
    '  select max(n) into v_max from public.schema_version;',
    `  if v_max is not null and v_max > ${n} then`,
    `    raise exception 'Refusing to run ${name}: migration % is already applied. `
      + `Apply the numbered files in order, or not at all.', v_max;`,
    '  end if;',
    'end',
    '$guard$;',
    '',
  ]

  const footer = [
    '',
    '-- Records this file as applied, for the ordering guard at the top.',
    `insert into public.schema_version (n) values (${n}) on conflict (n) do nothing;`,
    '',
  ]

  const next = [...lines.slice(0, i), ...guard, ...lines.slice(i)]
  const body = next.join('\n').replace(/\n+$/, '\n')
  await writeFile(path, body + footer.join('\n'), 'utf8')
  changed.push(name)
}

console.log(changed.length ? `Guarded ${changed.length} files:` : 'All files already guarded.')
changed.forEach((f) => console.log('  ' + f))
