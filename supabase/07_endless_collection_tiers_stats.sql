-- BOTC Wordle: server-side Endless, collection tiers, summary stats, rematch,
-- and synchronised round starts. Run AFTER 06_profiles_collection_stats.sql.
-- Safe to re-run.

-- ===========================================================================
-- 1. Collection tiers
-- ===========================================================================
-- A character can be earned two ways, and they are not worth the same. Dailies
-- are server-checked against a puzzle everyone shares; Endless is self-directed
-- and infinitely repeatable. Both unlock the avatar, only the daily earns the
-- mark.
alter table public.user_collection add column if not exists earned_daily   bool not null default false;
alter table public.user_collection add column if not exists earned_endless bool not null default false;
alter table public.user_collection add column if not exists earned_pvp     bool not null default false;

-- Everything recorded before tiers existed came from a daily.
update public.user_collection set earned_daily = true
where not earned_daily and not earned_endless and not earned_pvp;

-- These functions change shape rather than body, so CREATE OR REPLACE is not
-- enough: Postgres refuses a new return type, and a new defaulted parameter
-- leaves the old overload in place and makes every call ambiguous.
drop function if exists public.record_collection(uuid, text);
drop function if exists public.record_collection(uuid, text, text);
drop function if exists public.my_collection();
drop function if exists public.global_stats();
drop function if exists public.user_detail_stats(text);
drop function if exists public.user_detail_stats(text, text);

/** Records a win, remembering which mode earned it. */
create or replace function public.record_collection(
  p_user uuid, p_character_id text, p_source text default 'daily'
)
returns void language sql security definer set search_path = public as $$
  insert into public.user_collection (user_id, character_id, earned_daily, earned_endless, earned_pvp)
  values (
    p_user, p_character_id,
    p_source = 'daily', p_source = 'endless', p_source = 'pvp'
  )
  on conflict (user_id, character_id) do update set
    earned_count   = public.user_collection.earned_count + 1,
    earned_daily   = public.user_collection.earned_daily   or (p_source = 'daily'),
    earned_endless = public.user_collection.earned_endless or (p_source = 'endless'),
    earned_pvp     = public.user_collection.earned_pvp     or (p_source = 'pvp');
$$;

create or replace function public.my_collection()
returns table (
  character_id text, first_earned_at timestamptz, earned_count int,
  earned_daily bool, earned_endless bool, earned_pvp bool
)
language sql stable security definer set search_path = public as $$
  select character_id, first_earned_at, earned_count, earned_daily, earned_endless, earned_pvp
  from public.user_collection where user_id = auth.uid();
$$;

grant execute on function public.my_collection() to authenticated;

-- The client can no longer award itself anything.
drop function if exists public.record_endless_win(text);

-- ===========================================================================
-- 2. Endless, moved server side
-- ===========================================================================
-- Endless used to run entirely in the browser, which meant its wins were
-- self-reported and therefore worthless as a record. The answer now lives here
-- and never reaches the client until it is solved, exactly like the dailies.
create table if not exists public.endless_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  character_id text not null references public.characters(id),
  pools        jsonb not null default '{}'::jsonb,
  guesses      jsonb not null default '[]'::jsonb,
  guess_count  int  not null default 0,
  solved       bool not null default false,
  gave_up      bool not null default false,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz
);

alter table public.endless_sessions enable row level security;
-- Deliberately no select policy: the answer sits in this table. Reached only
-- through the RPCs below, which decide what to disclose.

create index if not exists endless_sessions_user_idx
  on public.endless_sessions (user_id, started_at desc);

/** Draws an Endless character honouring the player's pool toggles. */
create or replace function public.pick_endless(p_pools jsonb, p_exclude text[] default '{}')
returns text language plpgsql stable security definer set search_path = public as $$
declare pick text;
begin
  select c.id into pick
  from public.characters c
  where not (c.id = any(p_exclude))
    and (
      case
        when (c.pools ->> 'isStoryteller')::bool then coalesce((p_pools ->> 'storyteller')::bool, false)
        when (c.pools ->> 'isTraveller')::bool then
          coalesce((p_pools ->> 'travellers')::bool, true)
          and (coalesce((p_pools ->> 'base3')::bool, true) or coalesce((p_pools ->> 'experimental')::bool, true))
        when (c.pools ->> 'inBase3')::bool then coalesce((p_pools ->> 'base3')::bool, true)
        when (c.pools ->> 'isExperimental')::bool then coalesce((p_pools ->> 'experimental')::bool, true)
        else false
      end
    )
  order by random() limit 1;

  -- Never stall on an over-filtered pool.
  if pick is null then
    select c.id into pick from public.characters c
    where (c.pools ->> 'inBase3')::bool order by random() limit 1;
  end if;
  return pick;
end;
$$;

/** Starts a new Endless game. Returns the session without the answer. */
create or replace function public.start_endless(p_pools jsonb, p_exclude text[] default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_char text;
  v_id   uuid;
begin
  if v_user is null then raise exception 'Not signed in'; end if;

  v_char := public.pick_endless(coalesce(p_pools, '{}'::jsonb), coalesce(p_exclude, '{}'));

  insert into public.endless_sessions (user_id, character_id, pools)
  values (v_user, v_char, coalesce(p_pools, '{}'::jsonb))
  returning id into v_id;

  return jsonb_build_object('sessionId', v_id, 'guesses', '[]'::jsonb,
                            'guessCount', 0, 'solved', false, 'gaveUp', false);
end;
$$;

create or replace function public.submit_endless_guess(p_session_id uuid, p_guess_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user    uuid := auth.uid();
  v_session public.endless_sessions;
  v_guess   public.characters;
  v_ans     public.characters;
  v_clue    jsonb;
  v_solved  bool;
begin
  if v_user is null then raise exception 'Not signed in'; end if;

  select * into v_session from public.endless_sessions
  where id = p_session_id and user_id = v_user for update;
  if not found then raise exception 'No such game'; end if;
  if v_session.solved or v_session.gave_up then raise exception 'That game is already finished'; end if;

  select * into v_guess from public.characters where id = p_guess_id;
  if not found then raise exception 'Unknown character'; end if;

  select * into v_ans from public.characters where id = v_session.character_id;

  v_clue := public.botc_compare(v_guess.attrs, v_ans.attrs);
  v_solved := v_guess.id = v_ans.id;

  update public.endless_sessions
  set guesses = guesses || jsonb_build_array(
        jsonb_build_object('id', v_guess.id, 'name', v_guess.name, 'clue', v_clue)),
      guess_count = guess_count + 1,
      solved = v_solved,
      finished_at = case when v_solved then now() else finished_at end
  where id = v_session.id
  returning * into v_session;

  if v_solved then
    perform public.record_collection(v_user, v_ans.id, 'endless');
  end if;

  return jsonb_build_object(
    'clue', v_clue,
    'guessId', v_guess.id,
    'guessName', v_guess.name,
    'solved', v_solved,
    'guessCount', v_session.guess_count,
    'answerName', case
      when v_solved then v_ans.name
      when (v_session.guess_count - (case when v_solved then 1 else 0 end)) >= 4 then v_ans.name
      else null end,
    'answerId', case when v_solved then v_ans.id else null end
  );
end;
$$;

create or replace function public.give_up_endless(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_ans  public.characters;
begin
  update public.endless_sessions
  set gave_up = true, finished_at = now()
  where id = p_session_id and user_id = v_user and not solved and not gave_up;

  select c.* into v_ans from public.endless_sessions s
  join public.characters c on c.id = s.character_id
  where s.id = p_session_id and s.user_id = v_user;

  if not found then raise exception 'No such game'; end if;
  return jsonb_build_object('answerId', v_ans.id, 'answerName', v_ans.name);
end;
$$;

grant execute on function public.start_endless(jsonb, text[])       to authenticated;
grant execute on function public.submit_endless_guess(uuid, text)   to authenticated;
grant execute on function public.give_up_endless(uuid)              to authenticated;

-- ===========================================================================
-- 3. Summary stats, maintained on write
-- ===========================================================================
-- global_stats() previously called best_streak twice per player on every read,
-- which is fine for a handful of friends and quietly quadratic beyond that.
-- This keeps one row per player up to date as games finish, so the read is a
-- single indexed scan. A trigger rather than a materialised view because the
-- free tier has no scheduler to refresh one.
create table if not exists public.player_stats (
  user_id            uuid primary key references auth.users on delete cascade,
  classic_played     int not null default 0,
  classic_wins       int not null default 0,
  classic_guess_sum  int not null default 0,
  classic_streak     int not null default 0,
  full_played        int not null default 0,
  full_wins          int not null default 0,
  full_guess_sum     int not null default 0,
  full_streak        int not null default 0,
  collected          int not null default 0,
  collected_daily    int not null default 0,
  updated_at         timestamptz not null default now()
);

alter table public.player_stats enable row level security;
drop policy if exists player_stats_read on public.player_stats;
create policy player_stats_read on public.player_stats
  for select to authenticated using (true);

/** Recomputes one player's row. Cheap: it only ever touches their own games. */
create or replace function public.refresh_player_stats(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.player_stats (user_id) values (p_user)
  on conflict (user_id) do nothing;

  update public.player_stats s set
    classic_played = coalesce(c.played, 0),
    classic_wins = coalesce(c.wins, 0),
    classic_guess_sum = coalesce(c.guess_sum, 0),
    classic_streak = public.best_streak(p_user, 'classic'),
    full_played = coalesce(f.played, 0),
    full_wins = coalesce(f.wins, 0),
    full_guess_sum = coalesce(f.guess_sum, 0),
    full_streak = public.best_streak(p_user, 'full'),
    collected = coalesce(col.total, 0),
    collected_daily = coalesce(col.daily, 0),
    updated_at = now()
  from (select 1) dummy
  left join (
    select count(*)::int as played,
           count(*) filter (where solved)::int as wins,
           coalesce(sum(guess_count) filter (where solved), 0)::int as guess_sum
    from public.game_sessions
    where user_id = p_user and mode = 'classic' and not is_archive and puzzle_date is not null
  ) c on true
  left join (
    select count(*)::int as played,
           count(*) filter (where solved)::int as wins,
           coalesce(sum(guess_count) filter (where solved), 0)::int as guess_sum
    from public.game_sessions
    where user_id = p_user and mode = 'full' and not is_archive and puzzle_date is not null
  ) f on true
  left join (
    select count(*)::int as total,
           count(*) filter (where earned_daily)::int as daily
    from public.user_collection where user_id = p_user
  ) col on true
  where s.user_id = p_user;
end;
$$;

create or replace function public.tg_refresh_player_stats()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_player_stats(coalesce(new.user_id, old.user_id));
  return null;
end;
$$;

drop trigger if exists game_sessions_stats on public.game_sessions;
create trigger game_sessions_stats
  after insert or update or delete on public.game_sessions
  for each row execute function public.tg_refresh_player_stats();

drop trigger if exists user_collection_stats on public.user_collection;
create trigger user_collection_stats
  after insert or update or delete on public.user_collection
  for each row execute function public.tg_refresh_player_stats();

/** Backfill, and a repair hatch if the summary ever drifts. */
create or replace function public.rebuild_player_stats()
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from public.profiles loop
    perform public.refresh_player_stats(r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

select public.rebuild_player_stats();

-- Now a plain scan rather than two function calls per player.
create or replace function public.global_stats()
returns table (
  username      text,
  pronouns      text,
  avatar        text,
  played        int,
  wins          int,
  avg_guesses   numeric,
  collected     int,
  collected_daily int,
  best_streak   int
)
language sql stable security definer set search_path = public as $$
  select
    p.username,
    p.pronouns,
    p.avatar_character_id,
    (coalesce(s.classic_played, 0) + coalesce(s.full_played, 0))::int,
    (coalesce(s.classic_wins, 0) + coalesce(s.full_wins, 0))::int,
    case
      when coalesce(s.classic_wins, 0) + coalesce(s.full_wins, 0) > 0
      then round(
        (coalesce(s.classic_guess_sum, 0) + coalesce(s.full_guess_sum, 0))::numeric
        / (coalesce(s.classic_wins, 0) + coalesce(s.full_wins, 0)), 2)
      else null
    end,
    coalesce(s.collected, 0)::int,
    coalesce(s.collected_daily, 0)::int,
    greatest(coalesce(s.classic_streak, 0), coalesce(s.full_streak, 0))::int
  from public.profiles p
  left join public.player_stats s on s.user_id = p.id
  order by coalesce(s.collected, 0) desc,
           (coalesce(s.classic_wins, 0) + coalesce(s.full_wins, 0)) desc;
$$;

grant execute on function public.global_stats() to authenticated;
grant execute on function public.rebuild_player_stats() to authenticated;

-- Per-player detail, now split by mode so the Classic and Full tabs differ.
create or replace function public.user_detail_stats(
  p_username text default null,
  p_mode     text default null
)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_user uuid;
begin
  if p_username is null then v_user := auth.uid();
  else select id into v_user from public.profiles where lower(username) = lower(p_username);
  end if;
  if v_user is null then raise exception 'No such player'; end if;

  return jsonb_build_object(
    'username', (select username from public.profiles where id = v_user),
    'mode', p_mode,
    'collected', (select count(*) from public.user_collection where user_id = v_user),
    'collectedDaily', (select count(*) from public.user_collection
                       where user_id = v_user and earned_daily),
    'totalCharacters', (select count(*) from public.characters
                        where not (pools ->> 'isStoryteller')::bool),
    'fastest', (
      select jsonb_build_object('characterId', s.character_id, 'name', c.name,
        'seconds', round(extract(epoch from (s.finished_at - s.started_at))::numeric, 1),
        'guesses', s.guess_count)
      from public.game_sessions s
      join public.characters c on c.id = s.character_id
      where s.user_id = v_user and s.solved and s.finished_at is not null
        and (p_mode is null or s.mode = p_mode)
        and extract(epoch from (s.finished_at - s.started_at)) between 1 and 3600
      order by (s.finished_at - s.started_at) asc limit 1
    ),
    'toughest', (
      select jsonb_build_object('characterId', s.character_id, 'name', c.name,
        'guesses', s.guess_count)
      from public.game_sessions s
      join public.characters c on c.id = s.character_id
      where s.user_id = v_user and s.solved and (p_mode is null or s.mode = p_mode)
      order by s.guess_count desc limit 1
    ),
    'byScript', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'script', script, 'wins', wins, 'avgGuesses', avg_guesses) order by avg_guesses asc), '[]'::jsonb)
      from (
        select c.attrs ->> 'script' as script, count(*)::int as wins,
               round(avg(s.guess_count), 2) as avg_guesses
        from public.game_sessions s
        join public.characters c on c.id = s.character_id
        where s.user_id = v_user and s.solved and (p_mode is null or s.mode = p_mode)
        group by c.attrs ->> 'script'
      ) t
    )
  );
end;
$$;

grant execute on function public.user_detail_stats(text, text) to authenticated;
