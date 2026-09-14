-- BOTC Wordle: profiles, collection and expanded stats.
-- Run AFTER 05_pvp.sql. Safe to re-run.

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
  if v_max is not null and v_max > 6 then
    raise exception 'Refusing to run 06_profiles_collection_stats.sql: migration % is already applied. Apply the numbered files in order, or not at all.', v_max;
  end if;
end
$guard$;


-- ---------------------------------------------------------------------------
-- Profile fields
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists pronouns text;
alter table public.profiles add column if not exists avatar_character_id text
  references public.characters(id) on delete set null;

alter table public.profiles drop constraint if exists profiles_pronouns_shape;
alter table public.profiles add constraint profiles_pronouns_shape
  check (pronouns is null or pronouns ~ '^[A-Za-z/ ''-]{1,24}$');

-- ---------------------------------------------------------------------------
-- Collection
-- ---------------------------------------------------------------------------
-- Every character a player has correctly named, from any mode.
create table if not exists public.user_collection (
  user_id         uuid not null references auth.users on delete cascade,
  character_id    text not null references public.characters(id) on delete cascade,
  first_earned_at timestamptz not null default now(),
  earned_count    int not null default 1,
  primary key (user_id, character_id)
);

alter table public.user_collection enable row level security;

drop policy if exists collection_read_all on public.user_collection;
-- Readable by all signed-in players so a profile can show someone's collection.
create policy collection_read_all on public.user_collection
  for select to authenticated using (true);

create index if not exists user_collection_user_idx on public.user_collection (user_id);

/** Records a win. Called by the daily RPC and by Endless. */
create or replace function public.record_collection(p_user uuid, p_character_id text)
returns void language sql security definer set search_path = public as $$
  insert into public.user_collection (user_id, character_id)
  values (p_user, p_character_id)
  on conflict (user_id, character_id)
  do update set earned_count = public.user_collection.earned_count + 1;
$$;

/**
 * Endless is played entirely in the browser, so its wins can only be reported
 * by the client. That is unverifiable: someone could call this for characters
 * they never solved. The stakes are deliberately low, it only affects which
 * avatars they can pick and a completion count, and the dailies (which feed
 * streaks and the leaderboard) remain server-checked.
 */
create or replace function public.record_endless_win(p_character_id text)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Not signed in'; end if;
  if not exists (select 1 from public.characters where id = p_character_id) then
    raise exception 'Unknown character';
  end if;
  perform public.record_collection(v_user, p_character_id);
end;
$$;

grant execute on function public.record_endless_win(text) to authenticated;

-- Backfill from dailies already solved before the collection existed.
insert into public.user_collection (user_id, character_id, first_earned_at)
select s.user_id, s.character_id, min(s.finished_at)
from public.game_sessions s
where s.solved and s.character_id is not null
group by s.user_id, s.character_id
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Profile updates
-- ---------------------------------------------------------------------------
/**
 * Updates pronouns and avatar.
 *
 * The avatar must be a character the player has actually earned. That check
 * lives here rather than in the client because it is the only thing stopping
 * anyone setting the token they like best by editing a request.
 */
create or replace function public.update_profile(
  p_pronouns text default null,
  p_avatar    text default null,
  p_clear_pronouns bool default false,
  p_clear_avatar   bool default false
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Not signed in'; end if;

  if p_avatar is not null and not exists (
    select 1 from public.user_collection
    where user_id = v_user and character_id = p_avatar
  ) then
    raise exception 'You have not earned that character yet';
  end if;

  update public.profiles
  set pronouns = case
        when p_clear_pronouns then null
        when p_pronouns is not null then nullif(trim(p_pronouns), '')
        else pronouns end,
      avatar_character_id = case
        when p_clear_avatar then null
        when p_avatar is not null then p_avatar
        else avatar_character_id end
  where id = v_user;

  return (select to_jsonb(p) from public.profiles p where p.id = v_user);
end;
$$;

grant execute on function public.update_profile(text, text, bool, bool) to authenticated;

-- ---------------------------------------------------------------------------
-- Stats
-- ---------------------------------------------------------------------------

/**
 * Longest run of consecutive solved days for one player and mode.
 *
 * Classic gaps-and-islands: consecutive dates share (date - row_number), so
 * grouping on that difference yields the runs. Archive replays are excluded --
 * counting them would let anyone build a streak backwards through history.
 */
create or replace function public.best_streak(p_user uuid, p_mode text)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(max(run), 0) from (
    select count(*) as run
    from (
      select s.puzzle_date,
             s.puzzle_date - (row_number() over (order by s.puzzle_date))::int as grp
      from public.game_sessions s
      where s.user_id = p_user and s.mode = p_mode
        and s.solved and not s.is_archive and s.puzzle_date is not null
    ) t
    group by grp
  ) runs;
$$;

/** Leaderboard across every player. One row each, all modes combined. */
create or replace function public.global_stats()
returns table (
  username      text,
  pronouns      text,
  avatar        text,
  played        int,
  wins          int,
  avg_guesses   numeric,
  collected     int,
  best_streak   int
)
language sql stable security definer set search_path = public as $$
  select
    p.username,
    p.pronouns,
    p.avatar_character_id,
    coalesce(g.played, 0)::int,
    coalesce(g.wins, 0)::int,
    round(g.avg_guesses, 2),
    coalesce(c.collected, 0)::int,
    greatest(public.best_streak(p.id, 'classic'), public.best_streak(p.id, 'full'))
  from public.profiles p
  left join (
    select user_id,
           count(*) filter (where not is_archive and puzzle_date is not null) as played,
           count(*) filter (where solved and not is_archive and puzzle_date is not null) as wins,
           avg(guess_count) filter (where solved and not is_archive and puzzle_date is not null)
             as avg_guesses
    from public.game_sessions group by user_id
  ) g on g.user_id = p.id
  left join (
    select user_id, count(*) as collected from public.user_collection group by user_id
  ) c on c.user_id = p.id
  order by coalesce(c.collected, 0) desc, coalesce(g.wins, 0) desc;
$$;

grant execute on function public.global_stats() to authenticated;

/** Per-script averages and the standout games for one player. */
create or replace function public.user_detail_stats(p_username text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_user uuid;
  v_result jsonb;
begin
  if p_username is null then
    v_user := auth.uid();
  else
    select id into v_user from public.profiles where lower(username) = lower(p_username);
  end if;
  if v_user is null then raise exception 'No such player'; end if;

  select jsonb_build_object(
    'username', (select username from public.profiles where id = v_user),
    'pronouns', (select pronouns from public.profiles where id = v_user),
    'avatar',   (select avatar_character_id from public.profiles where id = v_user),
    'collected', (select count(*) from public.user_collection where user_id = v_user),
    'totalCharacters', (select count(*) from public.characters
                        where not (pools ->> 'isStoryteller')::bool),

    -- Quickest solve by wall clock. Only dailies are timed; Endless is not.
    'fastest', (
      select jsonb_build_object(
        'characterId', s.character_id,
        'name', c.name,
        'seconds', round(extract(epoch from (s.finished_at - s.started_at))::numeric, 1),
        'guesses', s.guess_count)
      from public.game_sessions s
      join public.characters c on c.id = s.character_id
      where s.user_id = v_user and s.solved and s.finished_at is not null
        and extract(epoch from (s.finished_at - s.started_at)) between 1 and 3600
      order by (s.finished_at - s.started_at) asc limit 1
    ),

    -- The one that fought back hardest, by guesses rather than by clock.
    'toughest', (
      select jsonb_build_object(
        'characterId', s.character_id,
        'name', c.name,
        'guesses', s.guess_count)
      from public.game_sessions s
      join public.characters c on c.id = s.character_id
      where s.user_id = v_user and s.solved
      order by s.guess_count desc limit 1
    ),

    -- Average guesses per script, so a player can see which set they know best.
    'byScript', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'script', script, 'wins', wins, 'avgGuesses', avg_guesses
      ) order by avg_guesses asc), '[]'::jsonb)
      from (
        select c.attrs ->> 'script' as script,
               count(*)::int as wins,
               round(avg(s.guess_count), 2) as avg_guesses
        from public.game_sessions s
        join public.characters c on c.id = s.character_id
        where s.user_id = v_user and s.solved
        group by c.attrs ->> 'script'
        having count(*) >= 1
      ) t
    )
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.user_detail_stats(text) to authenticated;

/** A player's collection, for the collection page and avatar picker. */
create or replace function public.my_collection()
returns table (character_id text, first_earned_at timestamptz, earned_count int)
language sql stable security definer set search_path = public as $$
  select character_id, first_earned_at, earned_count
  from public.user_collection where user_id = auth.uid();
$$;

grant execute on function public.my_collection() to authenticated;

-- ---------------------------------------------------------------------------
-- Record daily wins into the collection
-- ---------------------------------------------------------------------------
-- Re-declared here so the collection is written on every daily solve. This is
-- the same function as in 02_functions.sql with one added line; running that
-- file again afterwards would silently undo it, so keep them in sync.
create or replace function public.submit_daily_guess(p_session_id uuid, p_guess_id text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_user    uuid := auth.uid();
  v_session public.game_sessions;
  v_answer  text;
  v_guess   public.characters;
  v_ans     public.characters;
  v_clue    jsonb;
  v_solved  bool;
  v_entry   jsonb;
begin
  if v_user is null then
    raise exception 'Not signed in';
  end if;

  select * into v_session from public.game_sessions
  where id = p_session_id and user_id = v_user
  for update;

  if not found then raise exception 'No such session'; end if;
  if v_session.solved or v_session.gave_up then
    raise exception 'That game is already finished';
  end if;

  select * into v_guess from public.characters where id = p_guess_id;
  if not found then raise exception 'Unknown character: %', p_guess_id; end if;

  select character_id into v_answer from public.daily_puzzles
  where puzzle_date = v_session.puzzle_date and mode = v_session.mode;

  select * into v_ans from public.characters where id = v_answer;

  v_clue := public.botc_compare(v_guess.attrs, v_ans.attrs);
  v_solved := (v_guess.id = v_ans.id);

  v_entry := jsonb_build_object('id', v_guess.id, 'name', v_guess.name, 'clue', v_clue);

  update public.game_sessions
  set guesses      = guesses || jsonb_build_array(v_entry),
      guess_count  = guess_count + 1,
      solved       = v_solved,
      character_id = case when v_solved then v_ans.id else character_id end,
      finished_at  = case when v_solved then now() else finished_at end
  where id = v_session.id
  returning * into v_session;

  if v_solved then
    perform public.record_collection(v_user, v_ans.id);
  end if;

  return jsonb_build_object(
    'clue', v_clue,
    'guessId', v_guess.id,
    'guessName', v_guess.name,
    'solved', v_solved,
    'guessCount', v_session.guess_count,
    'wrongCount', v_session.guess_count - (case when v_solved then 1 else 0 end),
    'answerName', case
      when v_solved then v_ans.name
      when (v_session.guess_count - (case when v_solved then 1 else 0 end)) >= 4 then v_ans.name
      else null
    end,
    'answerId', case when v_solved then v_ans.id else null end
  );
end;
$$;

grant execute on function public.submit_daily_guess(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Leaderboard, now carrying pronouns and avatar
-- ---------------------------------------------------------------------------
-- Replaces the version in 03_policies.sql. Still returns no character_id, so
-- reading a friend's result cannot reveal today's answer.
drop function if exists public.daily_leaderboard(date, text);

create or replace function public.daily_leaderboard(p_date date default null, p_mode text default null)
returns table (
  username    text,
  pronouns    text,
  avatar      text,
  mode        text,
  puzzle_date date,
  guess_count int,
  solved      bool,
  finished_at timestamptz
)
language sql security definer set search_path = public stable as $$
  select p.username, p.pronouns, p.avatar_character_id,
         s.mode, s.puzzle_date, s.guess_count, s.solved, s.finished_at
  from public.game_sessions s
  join public.profiles p on p.id = s.user_id
  where s.puzzle_date is not null
    and s.is_archive = false
    and (s.solved or s.gave_up)
    and s.puzzle_date = coalesce(p_date, (now() at time zone 'utc')::date)
    and (p_mode is null or s.mode = p_mode)
    and s.puzzle_date <= (now() at time zone 'utc')::date
  order by s.solved desc, s.guess_count asc, s.finished_at asc;
$$;

grant execute on function public.daily_leaderboard(date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Indexes for the query patterns the app actually makes
-- ---------------------------------------------------------------------------
-- Stats reads every session for one user, filtered to finished dailies.
create index if not exists game_sessions_user_mode_date_idx
  on public.game_sessions (user_id, mode, puzzle_date desc)
  where puzzle_date is not null and is_archive = false;

-- best_streak scans one user's solved dailies in date order.
create index if not exists game_sessions_streak_idx
  on public.game_sessions (user_id, mode, puzzle_date)
  where solved and not is_archive and puzzle_date is not null;

-- archive_list joins daily_puzzles to the caller's sessions.
create index if not exists daily_puzzles_mode_date_idx
  on public.daily_puzzles (mode, puzzle_date desc);

-- PvP state is read on every realtime nudge and every poll.
create index if not exists pvp_rounds_match_position_idx
  on public.pvp_rounds (match_id, cycle, round_no);
create index if not exists pvp_participants_user_idx
  on public.pvp_participants (user_id);

-- Records this file as applied, for the ordering guard at the top.
insert into public.schema_version (n) values (6) on conflict (n) do nothing;
