-- BOTC Wordle: achievements, titles, avatar frames and public profiles.
-- Run AFTER 16_parity_hooks.sql. Safe to re-run.
--
-- Until now the only thing a player could earn was a character token to use as
-- a profile picture, and the only person who ever saw it was them. This adds a
-- progression loop on top of the records the database already keeps:
--
--   achievements       a catalogue of milestones, seeded here as data
--   user_achievements  one row per player per milestone, with stored progress
--   profiles.title     an earned title worn next to your name
--   profiles.frame     an earned ring drawn around your avatar
--   public_profile()   what everyone else sees when they click your name
--
-- Nothing here re-derives anything. Progress reads player_stats and
-- player_ratings, which are already kept current by triggers, and awarding
-- hangs off the trigger function that maintains them rather than adding a
-- second mechanism that could disagree with the first.
--
-- Progress is stored rather than computed on read so the checklist renders
-- without running eighteen aggregates per page load.

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
  if v_max is not null and v_max > 17 then
    raise exception 'Refusing to run 17_achievements.sql: migration % is already applied. Apply the numbered files in order, or not at all.', v_max;
  end if;
end
$guard$;


-- ===========================================================================
-- 1. Catalogue and progress
-- ===========================================================================
create table if not exists public.achievements (
  id           text primary key,
  name         text not null,
  description  text not null,
  category     text not null check (category in ('dailies', 'collection', 'versus')),
  -- What counts as done. Boolean milestones use 1.
  goal         int  not null check (goal > 0),
  -- The cosmetic this unlocks. A title on every one, a frame on a few, so
  -- frames stay the scarcer of the two.
  grants_title text,
  grants_frame text,
  sort         int  not null default 0
);

create table if not exists public.user_achievements (
  user_id        uuid not null references auth.users on delete cascade,
  achievement_id text not null references public.achievements(id) on delete cascade,
  progress       int  not null default 0,
  -- Null while still in progress. Once stamped it is never cleared: a streak
  -- you lose does not take the achievement with it.
  earned_at      timestamptz,
  primary key (user_id, achievement_id)
);

create index if not exists user_achievements_earned_idx
  on public.user_achievements (user_id) where earned_at is not null;

alter table public.achievements      enable row level security;
alter table public.user_achievements enable row level security;

-- Both are readable by any signed-in player, because a public profile has to
-- show someone else's. Neither has an insert or update policy: every write
-- goes through the security definer functions below.
drop policy if exists achievements_read on public.achievements;
create policy achievements_read on public.achievements
  for select to anon, authenticated using (true);

drop policy if exists user_achievements_read on public.user_achievements;
create policy user_achievements_read on public.user_achievements
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- The catalogue itself
-- ---------------------------------------------------------------------------
-- Set-completion goals are read from the character data rather than written
-- out, so they stay right if the data pipeline adds a character. Re-run
-- rebuild_achievements() after a seed that changes those counts.
--
-- greatest(..., 1) because goal has a positive check and a first-time setup can
-- reach this file before seed/characters.sql has run, where the counts would be
-- zero and the whole migration would fail on a constraint rather than on
-- anything a reader could diagnose.
insert into public.achievements (id, name, description, category, goal, grants_title, grants_frame, sort)
values
  -- Dailies ---------------------------------------------------------------
  ('first_solve', 'First Light',      'Solve your first daily.',                      'dailies',   1, 'Newly Woken',    null,        10),
  ('wins_10',     'Regular',          'Win 10 dailies.',                              'dailies',  10, 'Regular',        null,        20),
  ('wins_50',     'Devoted',          'Win 50 dailies.',                              'dailies',  50, 'Devoted',        'candle',    30),
  ('wins_200',    'Veteran',          'Win 200 dailies.',                             'dailies', 200, 'Veteran',        'ember',     40),
  ('streak_7',    'A Full Week',      'Reach a 7 day streak.',                        'dailies',   7, 'Steadfast',      null,        50),
  ('streak_30',   'A Full Month',     'Reach a 30 day streak.',                       'dailies',  30, 'Unbroken',       'moonlight', 60),
  ('one_guess',   'Called It',        'Solve a daily in a single guess.',             'dailies',   1, 'Oracle',         null,        70),
  -- Collection ------------------------------------------------------------
  ('collect_25',  'Collector',        'Name 25 different characters.',                'collection',  25, 'Collector',    null,      110),
  ('collect_75',  'Archivist',        'Name 75 different characters.',                'collection',  75, 'Archivist',    null,      120),
  ('collect_140', 'Loremaster',       'Name 140 different characters.',               'collection', 140, 'Loremaster',   'verdant', 130),
  ('rings_25',    'Ringbearer',       'Earn 25 gold rings.',                          'collection',  25, 'Ringbearer',   null,      140),
  ('set_tb',      'Trouble Brewer',   'Name every character in Trouble Brewing.',     'collection',
     greatest((select count(*)::int from public.characters where attrs ->> 'script' = 'tb'), 1),
     'Trouble Brewer', null, 150),
  ('set_base3',   'Grimoire Keeper',  'Name every character in the three base sets.', 'collection',
     greatest((select count(*)::int from public.characters where (pools ->> 'inBase3')::bool), 1),
     'Grimoire Keeper', 'storm', 160),
  ('mastered_1',  'Perfectionist',    'Name one character in all three modes.',       'collection',   1, 'Perfectionist', null,     170),
  -- Versus ----------------------------------------------------------------
  ('pvp_win_1',   'Duellist',         'Win a ranked Versus match.',                   'versus',    1, 'Duellist',       null,       210),
  ('pvp_win_10',  'Champion',         'Win 10 ranked Versus matches.',                'versus',   10, 'Champion',       null,       220),
  ('elo_1200',    'Contender',        'Reach a rating of 1200.',                      'versus', 1200, 'Contender',      null,       230),
  ('elo_1400',    'Executioner',      'Reach a rating of 1400.',                      'versus', 1400, 'Executioner',    null,       240),
  ('upset',       'Giant Slayer',     'Beat an opponent rated 100 or more above you.', 'versus',   1, 'Giant Slayer',   null,       250)
on conflict (id) do update set
  name         = excluded.name,
  description  = excluded.description,
  category     = excluded.category,
  goal         = excluded.goal,
  grants_title = excluded.grants_title,
  grants_frame = excluded.grants_frame,
  sort         = excluded.sort;

-- ===========================================================================
-- 2. Awarding
-- ===========================================================================
/**
 * Recomputes one player's progress and stamps anything newly finished.
 *
 * Reads the summary tables the caller has just refreshed rather than
 * re-aggregating game_sessions, so this costs a handful of indexed lookups.
 * Two milestones cannot be expressed as a counter and use an exists instead.
 *
 * Progress only ever moves forward (greatest) and earned_at is only ever set
 * (coalesce), so losing a streak or dropping rating does not take back what
 * was already earned.
 */
create or replace function public.refresh_achievements(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s          public.player_stats;
  r          public.player_ratings;
  v_wins     int;
  v_streak   int;
begin
  if p_user is null then return; end if;

  select * into s from public.player_stats  where user_id = p_user;
  select * into r from public.player_ratings where user_id = p_user;

  v_wins   := coalesce(s.classic_wins, 0) + coalesce(s.full_wins, 0);
  v_streak := greatest(coalesce(s.classic_streak, 0), coalesce(s.full_streak, 0));

  insert into public.user_achievements (user_id, achievement_id, progress, earned_at)
  select p_user, v.id, v.progress,
         case when v.progress >= a.goal then now() else null end
  from (values
    -- Cast the first row so the VALUES list has settled column types before
    -- the join, rather than leaving them unknown.
    ('first_solve'::text, least(v_wins, 1)::int),
    ('wins_10',     v_wins),
    ('wins_50',     v_wins),
    ('wins_200',    v_wins),
    ('streak_7',    v_streak),
    ('streak_30',   v_streak),
    ('one_guess',   (select count(*)::int from (
                       select 1 from public.game_sessions
                       where user_id = p_user and solved and guess_count = 1 and not is_archive
                       limit 1) x)),
    ('collect_25',  coalesce(s.collected, 0)),
    ('collect_75',  coalesce(s.collected, 0)),
    ('collect_140', coalesce(s.collected, 0)),
    ('rings_25',    coalesce(s.collected_daily, 0)),
    ('set_tb',      (select count(*)::int
                     from public.user_collection uc
                     join public.characters c on c.id = uc.character_id
                     where uc.user_id = p_user and c.attrs ->> 'script' = 'tb')),
    ('set_base3',   (select count(*)::int
                     from public.user_collection uc
                     join public.characters c on c.id = uc.character_id
                     where uc.user_id = p_user and (c.pools ->> 'inBase3')::bool)),
    -- Mastery is every mode, and Fabled and Loric are excluded because the
    -- dailies never serve them and pvp_pick_character never offers them, so
    -- two of the three flags are unreachable. See src/game/mastery.ts.
    ('mastered_1',  (select count(*)::int
                     from public.user_collection uc
                     join public.characters c on c.id = uc.character_id
                     where uc.user_id = p_user
                       and not (c.pools ->> 'isStoryteller')::bool
                       and uc.earned_daily and uc.earned_endless and uc.earned_pvp)),
    ('pvp_win_1',   least(coalesce(r.wins, 0), 1)),
    ('pvp_win_10',  coalesce(r.wins, 0)),
    ('elo_1200',    coalesce(r.peak_rating, 0)),
    ('elo_1400',    coalesce(r.peak_rating, 0)),
    ('upset',       (select count(*)::int from (
                       select 1
                       from public.pvp_match_history me
                       join public.pvp_match_history them
                         on them.match_id = me.match_id and them.user_id = me.opponent_id
                       where me.user_id = p_user
                         and me.outcome = 'win'
                         and me.rating_before is not null
                         and them.rating_before is not null
                         and them.rating_before - me.rating_before >= 100
                       limit 1) y))
  ) as v(id, progress)
  join public.achievements a on a.id = v.id
  on conflict (user_id, achievement_id) do update set
    progress  = greatest(public.user_achievements.progress, excluded.progress),
    earned_at = coalesce(public.user_achievements.earned_at, excluded.earned_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- Hook into the machinery that already runs
-- ---------------------------------------------------------------------------
-- The triggers on game_sessions and user_collection from 07 already call this
-- function on every write that could change a counter. Adding the achievement
-- pass here rather than adding triggers of our own means the two can never
-- disagree about when a player's figures changed. refresh_player_stats runs
-- first, so the summary is current by the time progress reads it.
create or replace function public.tg_refresh_player_stats()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_player_stats(coalesce(new.user_id, old.user_id));
  perform public.refresh_achievements(coalesce(new.user_id, old.user_id));
  return null;
end;
$$;

-- Ratings are the one input those triggers never touch.
create or replace function public.tg_refresh_rating_achievements()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_achievements(coalesce(new.user_id, old.user_id));
  return null;
end;
$$;

drop trigger if exists player_ratings_achievements on public.player_ratings;
create trigger player_ratings_achievements
  after insert or update on public.player_ratings
  for each row execute function public.tg_refresh_rating_achievements();

/** Backfill, and a repair hatch, mirroring rebuild_player_stats. */
create or replace function public.rebuild_achievements()
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from public.profiles loop
    perform public.refresh_achievements(r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

grant execute on function public.rebuild_achievements() to authenticated;

-- ===========================================================================
-- 3. Reading your own checklist
-- ===========================================================================
-- Returns the whole catalogue, not just what you have: locked entries come
-- back with their progress so the page can show how far off each one is.
drop function if exists public.my_achievements();
create or replace function public.my_achievements()
returns table (
  id           text,
  name         text,
  description  text,
  category     text,
  goal         int,
  grants_title text,
  grants_frame text,
  sort         int,
  progress     int,
  earned_at    timestamptz
)
language sql stable security definer set search_path = public as $$
  select a.id, a.name, a.description, a.category, a.goal,
         a.grants_title, a.grants_frame, a.sort,
         least(coalesce(ua.progress, 0), a.goal), ua.earned_at
  from public.achievements a
  left join public.user_achievements ua
    on ua.achievement_id = a.id and ua.user_id = auth.uid()
  order by a.sort;
$$;

grant execute on function public.my_achievements() to authenticated;

-- ===========================================================================
-- 4. Wearing what you earned
-- ===========================================================================
alter table public.profiles add column if not exists title text;
alter table public.profiles add column if not exists frame text;

-- Shape only. What is actually allowed is decided by update_profile against
-- what the player has earned; a check constraint cannot ask that question, and
-- a second list of valid values here would be one more thing to drift.
alter table public.profiles drop constraint if exists profiles_title_shape;
alter table public.profiles add constraint profiles_title_shape
  check (title is null or title ~ '^[A-Za-z ''-]{1,24}$');

alter table public.profiles drop constraint if exists profiles_frame_shape;
alter table public.profiles add constraint profiles_frame_shape
  check (frame is null or frame ~ '^[a-z]{1,20}$');

-- The parameter list grows, and every parameter has a default. Leaving the old
-- four-argument version in place would not override it, it would create a
-- second overload and make the client's existing named-argument call
-- ambiguous, so it has to go first.
drop function if exists public.update_profile(text, text, bool, bool);

/**
 * Updates pronouns, avatar, title and frame.
 *
 * Every cosmetic is checked against what the player has actually earned. Those
 * checks live here rather than in the client because they are the only thing
 * stopping anyone wearing whatever they like by editing a request.
 */
create or replace function public.update_profile(
  p_pronouns       text default null,
  p_avatar         text default null,
  p_clear_pronouns bool default false,
  p_clear_avatar   bool default false,
  p_title          text default null,
  p_frame          text default null,
  p_clear_title    bool default false,
  p_clear_frame    bool default false
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

  if p_title is not null and not exists (
    select 1 from public.user_achievements ua
    join public.achievements a on a.id = ua.achievement_id
    where ua.user_id = v_user and ua.earned_at is not null and a.grants_title = p_title
  ) then
    raise exception 'You have not earned that title yet';
  end if;

  if p_frame is not null and not exists (
    select 1 from public.user_achievements ua
    join public.achievements a on a.id = ua.achievement_id
    where ua.user_id = v_user and ua.earned_at is not null and a.grants_frame = p_frame
  ) then
    raise exception 'You have not earned that frame yet';
  end if;

  update public.profiles
  set pronouns = case
        when p_clear_pronouns then null
        when p_pronouns is not null then nullif(trim(p_pronouns), '')
        else pronouns end,
      avatar_character_id = case
        when p_clear_avatar then null
        when p_avatar is not null then p_avatar
        else avatar_character_id end,
      title = case
        when p_clear_title then null
        when p_title is not null then p_title
        else title end,
      frame = case
        when p_clear_frame then null
        when p_frame is not null then p_frame
        else frame end
  where id = v_user;

  return (select to_jsonb(p) from public.profiles p where p.id = v_user);
end;
$$;

grant execute on function public.update_profile(text, text, bool, bool, text, text, bool, bool)
  to authenticated;

-- ===========================================================================
-- 5. Titles and frames on the leaderboards
-- ===========================================================================
-- All three gain the same two columns. The return type changes, so each has to
-- be dropped rather than replaced.
drop function if exists public.global_stats();
create or replace function public.global_stats()
returns table (
  username        text,
  pronouns        text,
  avatar          text,
  title           text,
  frame           text,
  played          int,
  wins            int,
  avg_guesses     numeric,
  collected       int,
  collected_daily int,
  best_streak     int
)
language sql stable security definer set search_path = public as $$
  select
    p.username,
    p.pronouns,
    p.avatar_character_id,
    p.title,
    p.frame,
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

drop function if exists public.daily_leaderboard(date, text);
create or replace function public.daily_leaderboard(p_date date default null, p_mode text default null)
returns table (
  username    text,
  pronouns    text,
  avatar      text,
  title       text,
  frame       text,
  mode        text,
  puzzle_date date,
  guess_count int,
  solved      bool,
  finished_at timestamptz
)
language sql security definer set search_path = public stable as $$
  select p.username, p.pronouns, p.avatar_character_id, p.title, p.frame,
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

drop function if exists public.rating_leaderboard();
create or replace function public.rating_leaderboard()
returns table (
  username    text,
  pronouns    text,
  avatar      text,
  title       text,
  frame       text,
  rating      int,
  peak_rating int,
  games       int,
  wins        int,
  losses      int,
  draws       int
)
language sql stable security definer set search_path = public as $$
  select p.username, p.pronouns, p.avatar_character_id, p.title, p.frame,
         r.rating, r.peak_rating, r.games, r.wins, r.losses, r.draws
  from public.player_ratings r
  join public.profiles p on p.id = r.user_id
  where r.games > 0
  order by r.rating desc, r.games desc;
$$;

grant execute on function public.rating_leaderboard() to authenticated;

-- ===========================================================================
-- 6. Public profiles
-- ===========================================================================
/**
 * Everything one player can see about another, in a single round trip.
 *
 * Nothing new is exposed: the identity, the counters and the rating are all
 * already reachable through global_stats and rating_leaderboard. The
 * achievements are the addition, and they exist to be seen. Detail stats come
 * from user_detail_stats, which has always taken a username, rather than being
 * restated here.
 */
create or replace function public.public_profile(p_username text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_id uuid;
  v_p  public.profiles;
  v_s  public.player_stats;
  v_r  public.player_ratings;
begin
  select id into v_id from public.profiles where lower(username) = lower(p_username);
  if v_id is null then raise exception 'No such player'; end if;

  select * into v_p from public.profiles      where id = v_id;
  select * into v_s from public.player_stats  where user_id = v_id;
  select * into v_r from public.player_ratings where user_id = v_id;

  return jsonb_build_object(
    'username',  v_p.username,
    'pronouns',  v_p.pronouns,
    'avatar',    v_p.avatar_character_id,
    'title',     v_p.title,
    'frame',     v_p.frame,
    'joinedAt',  v_p.created_at,
    'played',    coalesce(v_s.classic_played, 0) + coalesce(v_s.full_played, 0),
    'wins',      coalesce(v_s.classic_wins, 0) + coalesce(v_s.full_wins, 0),
    'bestStreak', greatest(coalesce(v_s.classic_streak, 0), coalesce(v_s.full_streak, 0)),
    'collected',      coalesce(v_s.collected, 0),
    'collectedDaily', coalesce(v_s.collected_daily, 0),
    'mastered', (
      select count(*)::int
      from public.user_collection uc
      join public.characters c on c.id = uc.character_id
      where uc.user_id = v_id
        and not (c.pools ->> 'isStoryteller')::bool
        and uc.earned_daily and uc.earned_endless and uc.earned_pvp
    ),
    'rating',     case when coalesce(v_r.games, 0) > 0 then v_r.rating else null end,
    'peakRating', case when coalesce(v_r.games, 0) > 0 then v_r.peak_rating else null end,
    'pvpGames',   coalesce(v_r.games, 0),
    'pvpWins',    coalesce(v_r.wins, 0),
    'pvpLosses',  coalesce(v_r.losses, 0),
    'bySet', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'script', t.script, 'have', t.have, 'total', t.total
      ) order by t.script), '[]'::jsonb)
      from (
        select c.attrs ->> 'script' as script,
               count(*) filter (where uc.user_id is not null)::int as have,
               count(*)::int as total
        from public.characters c
        left join public.user_collection uc
          on uc.character_id = c.id and uc.user_id = v_id
        group by 1
      ) t
    ),
    'achievements', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.name, 'description', a.description,
        'category', a.category, 'earnedAt', ua.earned_at
      ) order by a.sort), '[]'::jsonb)
      from public.user_achievements ua
      join public.achievements a on a.id = ua.achievement_id
      where ua.user_id = v_id and ua.earned_at is not null
    ),
    'totalAchievements', (select count(*)::int from public.achievements)
  );
end;
$$;

grant execute on function public.public_profile(text) to authenticated;

-- ===========================================================================
-- 7. Titles and frames in the Versus lobby
-- ===========================================================================
-- Everything below is the definition from 14 with two keys added to the
-- players object. Copied rather than patched because plpgsql has no way to
-- amend a function in place, which is why every numbered file that touches
-- pvp_state restates it whole.
create or replace function public.pvp_state(p_match uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user  uuid := auth.uid();
  v_match public.pvp_matches;
  v_round public.pvp_rounds;
  v_mine  public.pvp_round_results;
  v_answer public.characters;
  v_finished bool;
  v_live bool;
begin
  select * into v_match from public.pvp_matches where id = p_match;
  if not found then raise exception 'No such match'; end if;
  if not exists (select 1 from public.pvp_participants
                 where match_id = p_match and user_id = v_user) then
    raise exception 'Not in this match';
  end if;

  select * into v_round from public.pvp_rounds
  where match_id = p_match and cycle = v_match.current_cycle and round_no = v_match.current_round;

  if v_round.id is not null then
    select * into v_mine from public.pvp_round_results
    where round_id = v_round.id and user_id = v_user;
    select c.* into v_answer
    from public.pvp_round_answers a
    join public.characters c on c.id = a.character_id
    where a.round_id = v_round.id and a.user_id = v_user;
  end if;

  v_live := v_round.starts_at is not null and now() >= v_round.starts_at;
  v_finished := v_match.status = 'finished'
                or (v_mine.finished_at is not null)
                or (v_round.ends_at is not null and now() > v_round.ends_at);

  return jsonb_build_object(
    'matchId', v_match.id,
    'joinCode', v_match.join_code,
    'status', v_match.status,
    'ranked', v_match.ranked,
    'isHost', v_match.host_id = v_user,
    'config', v_match.config,
    'cycles', v_match.cycles,
    'currentCycle', v_match.current_cycle,
    'currentRound', v_match.current_round,
    'rematchId', v_match.config ->> 'rematchId',
    'serverNow', now(),
    'players', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'userId', p.user_id,
        'username', pr.username,
        'pronouns', pr.pronouns,
        'avatar', pr.avatar_character_id,
        'title', pr.title,
        'frame', pr.frame,
        'rating', rt.rating,
        'score', p.score,
        'ready', p.ready,
        'isHost', p.user_id = v_match.host_id,
        'isMe', p.user_id = v_user
      ) order by p.joined_at), '[]'::jsonb)
      from public.pvp_participants p
      join public.profiles pr on pr.id = p.user_id
      left join public.player_ratings rt on rt.user_id = p.user_id
      where p.match_id = p_match
    ),
    'round', case when v_round.id is null then null else jsonb_build_object(
      'id', v_round.id,
      'kind', v_round.kind,
      'cycle', v_round.cycle,
      'roundNo', v_round.round_no,
      'phase', v_round.state ->> 'phase',
      'startsAt', v_round.starts_at,
      'startedAt', v_round.started_at,
      'endsAt', v_round.ends_at,
      'serverNow', now(),
      'live', v_live,
      'iHavePicked', exists (
        select 1 from public.pvp_round_answers a
        where a.round_id = v_round.id
          and a.user_id = public.pvp_opponent(p_match, v_user)
      ),
      'myGuesses', coalesce(v_mine.guesses, '[]'::jsonb),
      'myGuessCount', coalesce(v_mine.guess_count, 0),
      'mySolved', coalesce(v_mine.solved, false),
      'myPoints', coalesce(v_mine.points, 0),
      'myElapsedMs', v_mine.elapsed_ms,
      'myFinished', v_mine.finished_at is not null,
      'iconImage', case when v_round.kind = 'icon' then v_answer.id || '.webp' else null end,
      'answerName', case
        when v_round.kind = 'icon' then
          case when coalesce(v_mine.solved, false) or v_finished then v_answer.name else null end
        when coalesce(v_mine.solved, false) or coalesce(v_mine.guess_count, 0) >= 4 or v_finished
          then v_answer.name
        else null end,
      'answerId', case when coalesce(v_mine.solved, false) or v_finished
                       then v_answer.id else null end,
      'results', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'userId', res.user_id, 'points', res.points, 'solved', res.solved,
          'guessCount', res.guess_count, 'elapsedMs', res.elapsed_ms,
          'finished', res.finished_at is not null
        )), '[]'::jsonb)
        from public.pvp_round_results res where res.round_id = v_round.id
      )
    ) end
  );
end;
$$;

grant execute on function public.pvp_state(uuid) to authenticated;

-- ===========================================================================
-- 8. Backfill
-- ===========================================================================
-- Existing players get credit for everything they have already done.
select public.rebuild_achievements();

-- Records this file as applied, for the ordering guard at the top.
insert into public.schema_version (n) values (17) on conflict (n) do nothing;
