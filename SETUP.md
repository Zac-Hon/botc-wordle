# Setup

Everything here is on Supabase's and Vercel's free tiers. No card required.

## 1. Create the Supabase project

1. Go to <https://supabase.com/dashboard> and sign in (GitHub login is easiest).
2. **New project**. Name it anything. Choose a region near you and set a database
   password, save it in a password manager, you will not be shown it again.
3. Wait for provisioning (~2 minutes).

## 2. Turn off email confirmation

**This step is not optional.** Logins are username+password, so the app signs
users up with a synthesised address (`<username>@botc-wordle.local`) that can
never receive mail. If confirmation is left on, every account is created
unconfirmed and nobody can ever log in.

- **Authentication → Sign In / Providers → Email**
- Turn **Confirm email** OFF. Leave "Enable email provider" ON.

## 3. Run the SQL, in this order

Open **SQL Editor → New query**, then paste and run each file. Order matters ,
later files reference earlier ones.

| # | File | What it does |
|---|---|---|
| 1 | `supabase/01_schema.sql` | Tables, indexes, the new-user trigger |
| 2 | `supabase/02_functions.sql` | The clue comparator and the daily RPCs |
| 3 | `supabase/seed/characters.sql` | 181 characters + the clue grid definition |
| 4 | `supabase/seed/dailies.sql` | A year of puzzles for both daily modes |
| 5 | `supabase/03_policies.sql` | Row level security. **Run last.** |

All five are re-runnable, so if one fails halfway you can fix and run it again.

## 4. Point the app at it

**Project Settings → API**, then copy:

- **Project URL**
- **anon public** key, this one is safe in client code; it is designed to be
  public and every table is protected by the policies from step 5.

Do **not** copy the `service_role` key. The app never needs it, and it bypasses
all security.

Create a file called `.env` in the project root:

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

`.env` is gitignored. `.env.example` shows the shape without the values.

## 5. Verify it worked

```bash
npm run verify:parity
```

This is the important one. The clue logic exists twice, once in TypeScript for
Endless, once in the database for the dailies and PvP, where the answer must
never reach the browser. The script runs ~5,400 real character pairs through
both and fails loudly if they disagree on a single cell.

Then confirm the answers are actually hidden. In the browser console on the
running app, signed in:

```js
await supabase.from('daily_puzzles').select('*')
```

It must return **zero rows**. If it returns data, step 5 of the SQL did not run.

## Regenerating data

```bash
npm run build:data        # re-fetch characters and art from the official source
npm run build:dailies     # regenerate the puzzle schedule
npm run analyse:clues     # measure how well the current clue grid discriminates
npm test                  # the game engine test suite
```

`build:data` rewrites `supabase/seed/characters.sql`, so re-run that file in the
SQL editor after it. It clears `daily_puzzles` (character rows are referenced by
foreign key), so re-run `dailies.sql` too, the schedule is deterministic, so
already-played dates keep the same answers and nobody's streak is disturbed.

## Known limitation: password reset

Because the email addresses are synthesised, there is no self-service password
reset. Two mitigations:

- Players may add a real recovery email to their profile (`profiles.recovery_email`).
- You can reset any password from **Authentication → Users** in the dashboard.

If this becomes a nuisance, switching to real email addresses at signup is a
small change, the username stays as the display name either way.
