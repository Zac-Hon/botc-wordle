-- BOTC Wordle -- schema
-- Run this FIRST in the Supabase SQL Editor, then 02_functions.sql, then the
-- generated seed/characters.sql, then 03_policies.sql.
-- Safe to re-run: every statement is idempotent.

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
  if v_max is not null and v_max > 1 then
    raise exception 'Refusing to run 01_schema.sql: migration % is already applied. Apply the numbered files in order, or not at all.', v_max;
  end if;
end
$guard$;


-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
-- Auth is username+password. Supabase Auth is email-based, so the client signs
-- up with a synthesised address (<username>@botc-wordle.local) and the real
-- username lives here. Turn OFF "Confirm email" in Authentication > Providers,
-- or nobody will ever be able to log in.
create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  username    text not null,
  -- Optional and player-supplied. The ONLY password-recovery path, because
  -- synthesised addresses cannot receive mail.
  recovery_email text,
  created_at  timestamptz not null default now()
);

create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

-- Mirrors the client-side validation; the database is the real authority.
alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format
  check (username ~ '^[A-Za-z0-9_-]{3,20}$');

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Character data (seeded from src/data/characters.json by the build script)
-- ---------------------------------------------------------------------------
create table if not exists public.characters (
  id     text primary key,
  name   text not null,
  attrs  jsonb not null,
  pools  jsonb not null
);

-- Pool membership is queried on every daily draw.
create index if not exists characters_pools_idx on public.characters using gin (pools);

-- The clue grid definition, seeded from src/game/clueSpec.ts. The comparator in
-- 02_functions.sql is generic and driven entirely by these rows, so retuning a
-- column means re-running the seed rather than editing SQL by hand.
create table if not exists public.clue_spec (
  key         text primary key,
  ordinal     int  not null,
  label       text not null,
  short_label text not null,
  kind        text not null check (kind in ('group', 'exact', 'numeric', 'set')),
  params      jsonb not null default '{}'::jsonb
);

-- ---------------------------------------------------------------------------
-- Dailies
-- ---------------------------------------------------------------------------
-- Pre-seeded a year ahead. NEVER directly selectable: RLS grants nothing, and
-- the only way in is through the security-definer RPCs below. This is what
-- stops a player reading tomorrow's answer.
create table if not exists public.daily_puzzles (
  puzzle_date  date not null,
  mode         text not null check (mode in ('classic', 'full')),
  character_id text not null references public.characters(id),
  primary key (puzzle_date, mode)
);

-- ---------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------
create table if not exists public.game_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  mode         text not null check (mode in ('classic', 'full', 'endless', 'pvp')),
  puzzle_date  date,
  -- Null while a daily is in progress: revealing it here would defeat the RPC.
  character_id text references public.characters(id),
  guesses      jsonb not null default '[]'::jsonb,
  guess_count  int  not null default 0,
  solved       bool not null default false,
  gave_up      bool not null default false,
  is_archive   bool not null default false,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz
);

-- One live session per player per daily. Archive replays are exempt, and
-- Endless has no puzzle_date so it is unconstrained.
create unique index if not exists game_sessions_one_daily_idx
  on public.game_sessions (user_id, mode, puzzle_date)
  where puzzle_date is not null and is_archive = false;

create index if not exists game_sessions_user_idx on public.game_sessions (user_id, mode);
create index if not exists game_sessions_leaderboard_idx
  on public.game_sessions (puzzle_date, mode) where solved = true;

-- ---------------------------------------------------------------------------
-- PvP
-- ---------------------------------------------------------------------------
create table if not exists public.pvp_matches (
  id            uuid primary key default gen_random_uuid(),
  join_code     text not null unique,
  host_id       uuid not null references auth.users on delete cascade,
  config        jsonb not null default '{}'::jsonb,
  status        text not null default 'lobby'
                check (status in ('lobby', 'active', 'finished', 'abandoned')),
  cycles        int  not null default 1 check (cycles between 1 and 3),
  current_cycle int  not null default 1,
  current_round int  not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.pvp_participants (
  match_id  uuid not null references public.pvp_matches on delete cascade,
  user_id   uuid not null references auth.users on delete cascade,
  score     numeric not null default 0,
  ready     bool not null default false,
  joined_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

create table if not exists public.pvp_rounds (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null references public.pvp_matches on delete cascade,
  cycle      int  not null,
  round_no   int  not null check (round_no between 1 and 3),
  kind       text not null check (kind in ('icon', 'race', 'assigned')),
  started_at timestamptz,
  ends_at    timestamptz,
  state      jsonb not null default '{}'::jsonb,
  unique (match_id, cycle, round_no)
);

-- Held apart from pvp_rounds because that table must be client-readable for
-- Realtime to deliver round transitions, and these are the answers.
-- One row per player per round: round 3 sets a different character for each.
create table if not exists public.pvp_round_answers (
  round_id     uuid not null references public.pvp_rounds on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  character_id text not null references public.characters(id),
  primary key (round_id, user_id)
);

create table if not exists public.pvp_round_results (
  round_id    uuid not null references public.pvp_rounds on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  points      numeric not null default 0,
  -- Two separate things, deliberately named apart: the COUNT and the LIST.
  guess_count int not null default 0,
  guesses     jsonb not null default '[]'::jsonb,
  elapsed_ms  int,
  solved      bool not null default false,
  finished_at timestamptz,
  created_at  timestamptz not null default now(),
  primary key (round_id, user_id)
);

-- Realtime drives the lobby and the live rounds. Re-adding a table raises, so
-- this is guarded to keep the whole file re-runnable.
do $$
declare t text;
begin
  foreach t in array array['pvp_matches', 'pvp_rounds', 'pvp_round_results', 'pvp_participants']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- Records this file as applied, for the ordering guard at the top.
insert into public.schema_version (n) values (1) on conflict (n) do nothing;
