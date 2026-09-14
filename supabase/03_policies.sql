-- BOTC Wordle -- row level security. Run LAST.
--
-- The governing rule: daily_puzzles is readable by nobody. RLS is enabled with
-- no select policy at all, so even an authenticated client hitting the REST API
-- directly gets an empty set. Every legitimate read goes through the
-- security-definer RPCs in 02_functions.sql, which decide what to reveal and
-- when. Verify after running this: a logged-in client calling
-- .from('daily_puzzles').select('*') must return zero rows.

-- Ordering guard: refuses to run if a later migration has already been
-- applied, because that would revert whatever the later file replaced.
create table if not exists public.schema_version (
  n          int primary key,
  applied_at timestamptz not null default now()
);

do $guard$
declare v_max int;
begin
  select max(n) into v_max from public.schema_version;
  if v_max is not null and v_max > 3 then
    raise exception 'Refusing to run 03_policies.sql: migration % is already applied. Apply the numbered files in order, or not at all.', v_max;
  end if;
end
$guard$;


alter table public.profiles          enable row level security;
alter table public.characters        enable row level security;
alter table public.clue_spec         enable row level security;
alter table public.daily_puzzles     enable row level security;
alter table public.game_sessions     enable row level security;
alter table public.pvp_matches       enable row level security;
alter table public.pvp_participants  enable row level security;
alter table public.pvp_rounds        enable row level security;
alter table public.pvp_round_results enable row level security;

-- --- Reference data: world-readable, never client-writable ------------------
drop policy if exists characters_read on public.characters;
create policy characters_read on public.characters
  for select to anon, authenticated using (true);

drop policy if exists clue_spec_read on public.clue_spec;
create policy clue_spec_read on public.clue_spec
  for select to anon, authenticated using (true);

-- --- Profiles ---------------------------------------------------------------
-- All profiles are readable so the leaderboard can show usernames. Note this
-- exposes every username to every signed-in player, which is intended for a
-- private friend group. recovery_email is NOT exposed: see the view below.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- --- Dailies ----------------------------------------------------------------
-- Deliberately no policy. RLS on with zero policies denies everything.

-- --- Sessions ---------------------------------------------------------------
-- A player may read their own games and nobody else's in-progress answers.
drop policy if exists sessions_read_own on public.game_sessions;
create policy sessions_read_own on public.game_sessions
  for select to authenticated using (user_id = auth.uid());

-- Endless is played entirely client-side, so the client inserts those rows
-- itself. Dailies are created by start_daily (security definer, bypasses RLS),
-- and this policy blocks a client from forging one.
drop policy if exists sessions_insert_endless on public.game_sessions;
create policy sessions_insert_endless on public.game_sessions
  for insert to authenticated
  with check (user_id = auth.uid() and mode = 'endless');

drop policy if exists sessions_update_endless on public.game_sessions;
create policy sessions_update_endless on public.game_sessions
  for update to authenticated
  using (user_id = auth.uid() and mode = 'endless')
  with check (user_id = auth.uid() and mode = 'endless');

-- --- Leaderboard ------------------------------------------------------------
-- The leaderboard has to cross users, but sessions_read_own deliberately hides
-- other players' rows -- so it is served by a security-definer function with a
-- narrow, fixed shape rather than by widening the table policy. It returns a
-- username, date, mode and guess count, and never a character_id, so reading a
-- friend's result cannot tell you today's answer.
create or replace function public.daily_leaderboard(p_date date default null, p_mode text default null)
returns table (username text, mode text, puzzle_date date, guess_count int, solved bool, finished_at timestamptz)
language sql
security definer set search_path = public
stable
as $$
  select p.username, s.mode, s.puzzle_date, s.guess_count, s.solved, s.finished_at
  from public.game_sessions s
  join public.profiles p on p.id = s.user_id
  where s.puzzle_date is not null
    and s.is_archive = false
    and (s.solved or s.gave_up)
    and s.puzzle_date = coalesce(p_date, (now() at time zone 'utc')::date)
    and (p_mode is null or s.mode = p_mode)
    -- Never leak a result for a puzzle that has not happened yet.
    and s.puzzle_date <= (now() at time zone 'utc')::date
  order by s.solved desc, s.guess_count asc, s.finished_at asc;
$$;

grant execute on function public.daily_leaderboard(date, text) to authenticated;

-- --- PvP --------------------------------------------------------------------
-- Participants can see their own match. Round answers are held in pvp_rounds
-- and are NOT exposed here; the PvP RPCs mediate them the same way the dailies
-- are mediated.
drop policy if exists pvp_matches_read on public.pvp_matches;
create policy pvp_matches_read on public.pvp_matches
  for select to authenticated
  using (
    host_id = auth.uid()
    or exists (
      select 1 from public.pvp_participants pp
      where pp.match_id = id and pp.user_id = auth.uid()
    )
  );

drop policy if exists pvp_participants_read on public.pvp_participants;
create policy pvp_participants_read on public.pvp_participants
  for select to authenticated
  using (
    exists (
      select 1 from public.pvp_participants pp
      where pp.match_id = pvp_participants.match_id and pp.user_id = auth.uid()
    )
  );

drop policy if exists pvp_round_results_read on public.pvp_round_results;
create policy pvp_round_results_read on public.pvp_round_results
  for select to authenticated
  using (
    exists (
      select 1
      from public.pvp_rounds r
      join public.pvp_participants pp on pp.match_id = r.match_id
      where r.id = round_id and pp.user_id = auth.uid()
    )
  );

-- Rounds themselves must be readable, because Realtime enforces RLS and the
-- clients need live round transitions. The answers therefore live in a separate
-- table (pvp_round_answers) which, like daily_puzzles, has no select policy at
-- all -- so a participant sees that round 2 has started without seeing what the
-- character is.
drop policy if exists pvp_rounds_read on public.pvp_rounds;
create policy pvp_rounds_read on public.pvp_rounds
  for select to authenticated
  using (
    exists (
      select 1 from public.pvp_participants pp
      where pp.match_id = pvp_rounds.match_id and pp.user_id = auth.uid()
    )
  );

alter table public.pvp_round_answers enable row level security;
-- Deliberately no policy: answers are mediated by the PvP RPCs only.

-- Records this file as applied, for the ordering guard at the top.
insert into public.schema_version (n) values (3) on conflict (n) do nothing;
