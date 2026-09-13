# Deploying

Free on Vercel. Once it is connected, updating the live site is `git push`.

## 1. Put the code on GitHub

The repository is already initialised with one commit. Create an empty repo on
GitHub (**no** README, licence or .gitignore, the repo already has them), then:

```bash
git remote add origin https://github.com/YOUR-USERNAME/botc-wordle.git
git branch -M main
git push -u origin main
```

`.env` is gitignored, so your keys do not go to GitHub. `.env.example` shows the
shape without the values.

## 2. Connect Vercel

1. <https://vercel.com/new>, sign in with GitHub.
2. **Import** the repository.
3. Vercel reads `vercel.json` and detects Vite, so the build settings are
   already correct. Do not change them.
4. Before clicking Deploy, open **Environment Variables** and add both:

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://fukihpofoubiuawuaswd.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | your `sb_publishable_...` key |

   Tick all three environments (Production, Preview, Development).

   These are compiled into the client bundle, which is fine: the publishable key
   is designed to be public and the row level security policies are what
   actually protect the data. Never put a `sb_secret_...` key here.

5. **Deploy**. About a minute.

You get `https://your-project.vercel.app`. Share that with your friends.

## 3. Point Supabase at the live site

**Authentication → URL Configuration** in Supabase:

- **Site URL**: your Vercel URL.
- **Redirect URLs**: add your Vercel URL.

Sessions work without this, but setting it avoids surprises later if you ever
add email flows.

## Updating the live site

```bash
git add -A
git commit -m "what changed"
git push
```

Vercel rebuilds and ships in about a minute. Every push to `main` goes live;
every branch and pull request gets its own preview URL, so you can try something
without touching what your friends are playing.

## Changing the database

Schema changes are not part of the deploy. Run the SQL yourself in the Supabase
SQL Editor, in filename order:

| File | Purpose |
|---|---|
| `01_schema.sql` | Tables, indexes, new-user trigger |
| `02_functions.sql` | Clue comparator, daily RPCs |
| `seed/characters.sql` | 181 characters and the clue grid |
| `seed/dailies.sql` | A year of puzzles |
| `03_policies.sql` | Row level security. **Run before going live.** |
| `04_archive.sql` | Archive listing |
| `05_pvp.sql` | Versus |
| `06_profiles_collection_stats.sql` | Pronouns, avatars, collection |
| `07_endless_collection_tiers_stats.sql` | Server-side Endless, tiers, summary stats |
| `08_pvp_sync_rematch.sql` | Synchronised starts, rematch |
| `09_pvp_speed.sql` | Single round trip actions |
| `10_cleanup_test_user.sql` | One-off: removes the test account |
| `11_storyteller_tier.sql` | Fabled and Loric earn the top tier via Endless |
| `12_pvp_time_scoring.sql` | Time counts in the Versus deduction rounds |
| `13_pvp_time_weighting.sql` | Heavier time weighting, opponent pronouns in Versus |
| `14_ranked_elo_queue.sql` | Ranked Versus: Elo ratings and the matchmaking queue |
| `15_fix_ranked_start.sql` | Fixes ranked matches freezing before round one |

All are re-runnable.

## Before you share the link

```bash
npm test              # 156 tests
npm run verify:parity # TypeScript and Postgres agree on every clue and score
npm run build         # must succeed
```

Then, signed in on the live site, in the browser console:

```js
await supabase.from('daily_puzzles').select('*')
```

It must return **zero rows**. If it returns data, `03_policies.sql` has not run
and a year of answers is readable by anyone.

## Keeping the puzzles topped up

`seed/dailies.sql` covers 365 days. Before it runs out:

```bash
npm run build:dailies -- 2027-09-12 365
```

Then run the regenerated `supabase/seed/dailies.sql`. The schedule is
deterministic, so dates that already exist keep their answers and nobody's
streak is disturbed.

## Costs

Nothing, at this scale. Vercel's free tier covers the hosting; Supabase's free
tier covers the database, auth and realtime. Supabase pauses a project after a
week with no activity, and a single visit wakes it, so a daily game keeps itself
alive.
