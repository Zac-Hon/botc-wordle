# Architecture

How it is put together, and the handful of things worth understanding before
changing it.

## Shape

A Vite single-page app talking to Supabase. There is no server of our own: the
logic that must not run in the browser runs as Postgres functions instead.

```
  Browser (React + MUI)
      |
      |  supabase-js
      v
  Supabase
      Postgres  -- tables, RLS, SECURITY DEFINER functions
      Auth      -- username/password over synthesised emails
      Realtime  -- PvP lobby and rounds
```

## Where things live

```
src/
  data/        characters.json (generated), pools.ts
  game/        Pure game logic and the React hooks that drive each mode
  lib/         supabase.ts, moderation.ts
  store/       zustand: auth, settings
  components/  Grid, input, hangman, help, PvP round components
  routes/      One file per page
  theme/       MUI theme and the three clue colours
scripts/       Data pipeline, seeding, analysis, parity check
supabase/      Numbered SQL, applied in order by hand
docs/          This file and GAME.md
```

`src/game/` below the hooks is pure TypeScript with no React and no network:
`compare`, `hangman`, `scoring`, `closeness`, `daily`, `random`, `stats`. That
is what the 158 tests cover.

## The governing rule: answers never reach the browser early

Every mode resolves guesses server-side. The client sends a character id and
receives a clue row.

- `daily_puzzles` has **RLS enabled with no select policy at all**, so it is
  readable by nobody, authenticated or not. The only way in is through
  `SECURITY DEFINER` functions that decide what to disclose.
- The answer's **name** is released at four wrong guesses, because the hangman
  needs it. Its **identity** is released only on a solve or a give-up.
- `endless_sessions` and `pvp_round_answers` follow the same pattern for the
  same reason.

If you add a mode, this is the rule to preserve. The check worth running after
any policy change, signed in on the live site:

```js
await supabase.from('daily_puzzles').select('*')   // must be []
```

A player can still brute-force by calling the guess RPC repeatedly, but every
call is recorded, so their guess count reflects it. The protection that matters,
that nobody can read tomorrow's answer or today's before solving it, holds.

## The two-engine problem

This is the single most important thing to understand.

The clue comparator exists **twice**: in TypeScript (`src/game/compare.ts`) and
in plpgsql (`botc_compare`). It has to. Endless once ran in the browser and the
client still renders clue rows, while the dailies and Versus must compare
server-side so the answer stays hidden.

Two mitigations keep them honest:

1. **One declarative spec.** `src/game/clueSpec.ts` defines the columns once.
   The build script seeds those definitions into a `clue_spec` table, and both
   comparators are generic engines driven by it. Adding a column is a spec edit
   and a re-seed, not two hand-written implementations.
2. **A parity test.** `npm run verify:parity` runs thousands of real character
   pairs through both and demands byte-identical output, then does the same for
   every PvP scoring input and the Elo maths.

**Run it after any change to either comparator or to the scoring.** It needs
only the public anon key, because `botc_compare` takes both sides as arguments
and therefore reveals nothing.

## Data pipeline

`npm run build:data` fetches the official roles, night sheet and jinxes, joins
them, downloads all 181 token images, derives the attributes, applies
`data/tag-overrides.json`, and writes:

- `src/data/characters.json` for the app
- `supabase/seed/characters.sql` from the same in-memory objects, so the two
  cannot drift

It **fails the build** rather than guessing if a character cannot be classified
into a pool. That is deliberate: the failure mode it prevents is a mystery
character silently appearing in Daily Classic.

`npm run audit:data` goes further: it re-derives every attribute independently
and compares. Two data faults had already shipped past the build (ability tags
inverted by "(not yourself)", and every character waking only on later nights
reporting no night order), because neither looked wrong in the build output.
Run it after any change to the pipeline or the tag rules.

After running it, re-run the generated `seed/characters.sql` in Supabase.
Nothing else needs re-seeding: it upserts rather than replacing.

It used to delete every character row and re-insert, which was fine while only
`daily_puzzles` referenced them. Once real games existed it started failing on a
foreign key from `pvp_round_answers`, and cascading the delete would have thrown
away match history to refresh a name. It now upserts, and a character that has
vanished from the official data is only removed when nothing references it;
otherwise it is kept and reported. That check walks the foreign keys in
`information_schema` rather than a hard-coded list, so a table added later is
covered without anyone remembering to update the seed.

## Determinism

Nothing in the game uses `Math.random` except the Endless picker, which has
nothing to protect. Daily selection and the hangman reveal both run off a seeded
PRNG (`src/game/random.ts`), because every player must get the same puzzle and
the same reveal order. The daily seeding script and the browser agree without
coordinating because they compute the same function of the date.

## PvP

The hardest part, and the part with the most non-obvious decisions.

**Rounds advance without a scheduler.** The free tier has no cron, and making
one client the timekeeper breaks the moment they close the tab. Instead
`pvp_advance` is idempotent and *either* client calls it when the clock runs
out. The same applies to matchmaking: there is no matchmaker process, so pairing
happens inside `queue_join` and `queue_poll`, with `FOR UPDATE SKIP LOCKED` so
two simultaneous callers cannot claim the same opponent.

**Actions return the new state.** Each mutating RPC returns `pvp_state`, so a
click costs one round trip rather than two. The peer is told over Realtime
**broadcast**, which skips Postgres entirely; `postgres_changes` remains as a
slower backstop, plus a poll in case both are missed.

**Realtime says only that something changed.** Every notification triggers a
re-read of `pvp_state`, never a read of the payload, because the raw rows
contain answers that `pvp_state` deliberately withholds.

**Settlement is guarded.** Ranked Elo is applied inside a `settled` flag set in
the same row lock that reads it. Both clients call `pvp_advance` speculatively,
so without the guard every rating change would apply twice.

**Opening a round declares it current.** `pvp_open_round` sets the match's
`current_cycle`/`current_round` itself. These were once two steps a caller had
to remember to pair up, and `try_pair` forgot, which froze every ranked match at
"round 0 of 3".

## Auth

Supabase Auth is email-based, but the game signs in with a username, so each
username maps to a synthesised address `<username>@botc-wordle.local`. A trigger
creates the `profiles` row.

Two consequences:

- **"Confirm email" must be off** in the Supabase dashboard. With it on, every
  account is created unconfirmed and nobody can ever log in.
- **There is no self-service password reset**, because those addresses cannot
  receive mail. `profiles.recovery_email` exists for players who add one, and
  you can reset any password from Authentication → Users.

Tokens outlive the accounts they belong to, so deleting a user leaves their
browser presenting a valid JWT for a row that has gone. `isStaleSession` in
`src/lib/supabase.ts` catches the resulting foreign key failures and signs them
out with an explanation.

## Moderation

`src/lib/moderation.ts` screens usernames and pronouns. Two tiers: terms only
offensive as a standalone word are matched as whole tokens, so `jap` is blocked
but **Japan** is not; unambiguous slurs are matched anywhere but checked against
an allowlist first.

The design goal is explicitly not maximum catch rate. A filter that blocks
Scunthorpe is worse than no filter. When a real name gets caught, add it to
`ALLOWLIST` rather than loosening a rule. 66 tests cover this, most of them
being real words that must survive.

## Performance

The entry bundle is ~355 kB (~113 kB gzipped) with routes code-split, so a first
visit does not download Stats, Collection, Archive and all of Versus.

`player_stats` is a summary table maintained by triggers rather than a
materialised view, because a view would need a scheduled `REFRESH` and there is
no scheduler. The cost lands on whoever just finished a game, one row, and
`global_stats()` becomes a single indexed scan. `rebuild_player_stats()` is the
repair hatch if it ever drifts.

## Applying SQL

The numbered files in `supabase/` are applied **by hand, in order**, in the
Supabase SQL Editor. They are not part of the deploy: pushing ships the frontend
only. That is deliberate, so a push can never silently migrate the database.

All are re-runnable. Two gotchas, both of which fail at deploy time and are
invisible to the tests:

- `CREATE OR REPLACE FUNCTION` **cannot change a return type**. Add an explicit
  `DROP FUNCTION` first.
- Adding a **defaulted parameter** creates a new overload rather than replacing
  the old one, and every existing call then fails as ambiguous. Drop the old
  signature explicitly.

## Adding a clue column

1. Add it to `CLUE_SPEC` in `src/game/clueSpec.ts`.
2. Make sure `build-characters.ts` derives the attribute onto `attrs`.
3. `npm run build:data`, then run the regenerated `seed/characters.sql`.
4. `npm run analyse:clues` to check it earns its place. If it leaves most of the
   pool standing, it is decoration.
5. `npm run verify:parity` to confirm both engines agree about it.
