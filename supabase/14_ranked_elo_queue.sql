-- BOTC Wordle: ranked Versus, Elo ratings and a matchmaking queue.
-- Run AFTER 13_pvp_time_weighting.sql. Safe to re-run.
--
-- Ranked matches use the Daily Full pool: every player character including
-- experimentals and travellers, never Fabled or Loric. The settings are fixed
-- rather than host-chosen, because a rating is only meaningful if everyone
-- played the same game.

-- ===========================================================================
-- 1. Ratings
-- ===========================================================================
create table if not exists public.player_ratings (
  user_id      uuid primary key references auth.users on delete cascade,
  rating       int not null default 1000,
  peak_rating  int not null default 1000,
  games        int not null default 0,
  wins         int not null default 0,
  losses       int not null default 0,
  draws        int not null default 0,
  updated_at   timestamptz not null default now()
);

alter table public.player_ratings enable row level security;
drop policy if exists player_ratings_read on public.player_ratings;
create policy player_ratings_read on public.player_ratings
  for select to authenticated using (true);

create index if not exists player_ratings_rating_idx on public.player_ratings (rating desc);

/** One row per player per finished ranked match. */
create table if not exists public.pvp_match_history (
  match_id        uuid not null references public.pvp_matches on delete cascade,
  user_id         uuid not null references auth.users on delete cascade,
  opponent_id     uuid references auth.users on delete set null,
  ranked          bool not null default true,
  score           numeric not null default 0,
  opponent_score  numeric not null default 0,
  outcome         text not null check (outcome in ('win', 'loss', 'draw')),
  rating_before   int,
  rating_after    int,
  finished_at     timestamptz not null default now(),
  primary key (match_id, user_id)
);

alter table public.pvp_match_history enable row level security;
drop policy if exists match_history_read on public.pvp_match_history;
-- Readable by all signed-in players so head-to-head records can be shown.
create policy match_history_read on public.pvp_match_history
  for select to authenticated using (true);

create index if not exists match_history_user_idx
  on public.pvp_match_history (user_id, finished_at desc);

alter table public.pvp_matches add column if not exists ranked bool not null default false;
alter table public.pvp_matches add column if not exists settled bool not null default false;

/**
 * K-factor.
 *
 * High while provisional so a new player reaches their real level in a handful
 * of games rather than fifty, lower at the top where ratings should be stable.
 */
create or replace function public.elo_k(p_games int, p_rating int)
returns int language sql immutable as $$
  select case
    when coalesce(p_games, 0) < 10 then 40
    when coalesce(p_rating, 1000) >= 2000 then 10
    else 20
  end;
$$;

/** Standard Elo expectation for A against B. */
create or replace function public.elo_expected(p_a int, p_b int)
returns numeric language sql immutable as $$
  select 1.0 / (1.0 + power(10.0, (p_b - p_a)::numeric / 400.0));
$$;

create or replace function public.ensure_rating(p_user uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.player_ratings (user_id) values (p_user)
  on conflict (user_id) do nothing;
$$;

/**
 * Applies Elo once a ranked match finishes.
 *
 * Guarded by pvp_matches.settled so a match can only ever pay out once: both
 * clients call pvp_advance speculatively, so this would otherwise run twice and
 * double every rating change.
 */
create or replace function public.settle_ranked_match(p_match uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  m        public.pvp_matches;
  a        record;
  b        record;
  ra       public.player_ratings;
  rb       public.player_ratings;
  sa       numeric;
  sb       numeric;
  ea       numeric;
  ka       int;
  kb       int;
  new_a    int;
  new_b    int;
  outcome_a text;
  outcome_b text;
begin
  select * into m from public.pvp_matches where id = p_match for update;
  if not found or m.status <> 'finished' or m.settled then return; end if;

  -- Mark settled immediately, inside the same lock.
  update public.pvp_matches set settled = true where id = p_match;

  if not m.ranked then return; end if;

  select * into a from public.pvp_participants
  where match_id = p_match order by joined_at limit 1;
  select * into b from public.pvp_participants
  where match_id = p_match and user_id <> a.user_id limit 1;

  -- A match somebody abandoned before an opponent arrived is not a result.
  if a.user_id is null or b.user_id is null then return; end if;

  perform public.ensure_rating(a.user_id);
  perform public.ensure_rating(b.user_id);
  select * into ra from public.player_ratings where user_id = a.user_id;
  select * into rb from public.player_ratings where user_id = b.user_id;

  sa := case when a.score > b.score then 1 when a.score < b.score then 0 else 0.5 end;
  sb := 1 - sa;

  ea := public.elo_expected(ra.rating, rb.rating);
  ka := public.elo_k(ra.games, ra.rating);
  kb := public.elo_k(rb.games, rb.rating);

  new_a := round(ra.rating + ka * (sa - ea));
  new_b := round(rb.rating + kb * (sb - (1 - ea)));

  outcome_a := case when sa = 1 then 'win' when sa = 0 then 'loss' else 'draw' end;
  outcome_b := case when sb = 1 then 'win' when sb = 0 then 'loss' else 'draw' end;

  update public.player_ratings set
    rating = new_a,
    peak_rating = greatest(peak_rating, new_a),
    games = games + 1,
    wins = wins + (case when sa = 1 then 1 else 0 end),
    losses = losses + (case when sa = 0 then 1 else 0 end),
    draws = draws + (case when sa = 0.5 then 1 else 0 end),
    updated_at = now()
  where user_id = a.user_id;

  update public.player_ratings set
    rating = new_b,
    peak_rating = greatest(peak_rating, new_b),
    games = games + 1,
    wins = wins + (case when sb = 1 then 1 else 0 end),
    losses = losses + (case when sb = 0 then 1 else 0 end),
    draws = draws + (case when sb = 0.5 then 1 else 0 end),
    updated_at = now()
  where user_id = b.user_id;

  insert into public.pvp_match_history
    (match_id, user_id, opponent_id, ranked, score, opponent_score, outcome, rating_before, rating_after)
  values
    (p_match, a.user_id, b.user_id, true, a.score, b.score, outcome_a, ra.rating, new_a),
    (p_match, b.user_id, a.user_id, true, b.score, a.score, outcome_b, rb.rating, new_b)
  on conflict do nothing;
end;
$$;

-- Settle automatically the moment a match is marked finished.
create or replace function public.tg_settle_ranked()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'finished' and coalesce(old.status, '') <> 'finished' then
    perform public.settle_ranked_match(new.id);
  end if;
  return null;
end;
$$;

drop trigger if exists pvp_matches_settle on public.pvp_matches;
create trigger pvp_matches_settle
  after update of status on public.pvp_matches
  for each row execute function public.tg_settle_ranked();

-- ===========================================================================
-- 2. Matchmaking queue
-- ===========================================================================
create table if not exists public.matchmaking_queue (
  user_id   uuid primary key references auth.users on delete cascade,
  rating    int not null default 1000,
  queued_at timestamptz not null default now(),
  match_id  uuid references public.pvp_matches on delete set null
);

alter table public.matchmaking_queue enable row level security;
drop policy if exists queue_read_own on public.matchmaking_queue;
-- Your own row only: the queue is not a list of who is online.
create policy queue_read_own on public.matchmaking_queue
  for select to authenticated using (user_id = auth.uid());

create index if not exists queue_waiting_idx on public.matchmaking_queue (queued_at)
  where match_id is null;

/**
 * How far apart two ratings may be, widening with the longer wait.
 *
 * Starts at 150 and opens by 50 every five seconds, so a small player base
 * still finds a game rather than sitting in an empty queue forever.
 */
create or replace function public.queue_tolerance(p_waited_seconds numeric)
returns int language sql immutable as $$
  select least(2000, 150 + (floor(greatest(p_waited_seconds, 0) / 5) * 50)::int);
$$;

/**
 * Tries to pair the caller with someone already waiting.
 *
 * There is no scheduler on the free tier, so nobody can run a matchmaker loop.
 * Pairing therefore happens opportunistically whenever a player joins or polls.
 * FOR UPDATE SKIP LOCKED keeps two simultaneous callers from claiming the same
 * opponent, which would otherwise create two matches for one person.
 */
create or replace function public.try_pair(p_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me    public.matchmaking_queue;
  other public.matchmaking_queue;
  v_code text;
  v_match uuid;
begin
  select * into me from public.matchmaking_queue
  where user_id = p_user for update;
  if not found or me.match_id is not null then return me.match_id; end if;

  select q.* into other
  from public.matchmaking_queue q
  where q.user_id <> p_user
    and q.match_id is null
    and abs(q.rating - me.rating) <= greatest(
          public.queue_tolerance(extract(epoch from (now() - me.queued_at))),
          public.queue_tolerance(extract(epoch from (now() - q.queued_at))))
  order by abs(q.rating - me.rating) asc, q.queued_at asc
  for update skip locked
  limit 1;

  if not found then return null; end if;

  loop
    select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                             (random() * 31)::int + 1, 1), '')
    into v_code from generate_series(1, 6);
    exit when not exists (select 1 from public.pvp_matches where join_code = v_code);
  end loop;

  -- Ranked settings are fixed: the Daily Full pool, one cycle. A rating only
  -- means something if every ranked game is the same game.
  insert into public.pvp_matches (join_code, host_id, cycles, ranked, status, config)
  values (v_code, p_user, 1, true, 'active',
          '{"base3": true, "experimental": true, "travellers": true}'::jsonb)
  returning id into v_match;

  insert into public.pvp_participants (match_id, user_id, ready)
  values (v_match, p_user, true), (v_match, other.user_id, true);

  update public.matchmaking_queue set match_id = v_match
  where user_id in (p_user, other.user_id);

  -- Straight into round one; the lead-in gives both clients time to arrive.
  perform public.pvp_open_round(v_match, 1, 1);

  return v_match;
end;
$$;

create or replace function public.queue_join()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_rating int;
  v_match uuid;
begin
  if v_user is null then raise exception 'Not signed in'; end if;

  perform public.ensure_rating(v_user);
  select rating into v_rating from public.player_ratings where user_id = v_user;

  insert into public.matchmaking_queue (user_id, rating)
  values (v_user, v_rating)
  on conflict (user_id) do update set rating = excluded.rating, match_id = null;

  v_match := public.try_pair(v_user);

  return jsonb_build_object(
    'status', case when v_match is null then 'queued' else 'matched' end,
    'matchId', v_match,
    'rating', v_rating
  );
end;
$$;

create or replace function public.queue_poll()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  me public.matchmaking_queue;
  v_match uuid;
begin
  if v_user is null then raise exception 'Not signed in'; end if;

  select * into me from public.matchmaking_queue where user_id = v_user;
  if not found then return jsonb_build_object('status', 'idle'); end if;

  if me.match_id is not null then
    return jsonb_build_object('status', 'matched', 'matchId', me.match_id);
  end if;

  -- Poll doubles as a matchmaking tick: whoever is waiting drives the pairing.
  v_match := public.try_pair(v_user);

  return jsonb_build_object(
    'status', case when v_match is null then 'queued' else 'matched' end,
    'matchId', v_match,
    'waitedSeconds', round(extract(epoch from (now() - me.queued_at))),
    'tolerance', public.queue_tolerance(extract(epoch from (now() - me.queued_at)))
  );
end;
$$;

create or replace function public.queue_leave()
returns void language sql security definer set search_path = public as $$
  delete from public.matchmaking_queue where user_id = auth.uid() and match_id is null;
$$;

grant execute on function public.queue_join()  to authenticated;
grant execute on function public.queue_poll()  to authenticated;
grant execute on function public.queue_leave() to authenticated;

-- ===========================================================================
-- 3. Stats
-- ===========================================================================
/** The caller's ranked record, plus their recent matches. */
create or replace function public.my_pvp_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Not signed in'; end if;

  return jsonb_build_object(
    'rating', coalesce((select rating from public.player_ratings where user_id = v_user), 1000),
    'peak', coalesce((select peak_rating from public.player_ratings where user_id = v_user), 1000),
    'games', coalesce((select games from public.player_ratings where user_id = v_user), 0),
    'wins', coalesce((select wins from public.player_ratings where user_id = v_user), 0),
    'losses', coalesce((select losses from public.player_ratings where user_id = v_user), 0),
    'draws', coalesce((select draws from public.player_ratings where user_id = v_user), 0),
    -- Below ten games the rating is still moving fast and should be shown as
    -- provisional rather than presented as a settled number.
    'provisional', coalesce((select games from public.player_ratings where user_id = v_user), 0) < 10,
    'rank', (
      select count(*) + 1 from public.player_ratings r
      where r.games > 0
        and r.rating > coalesce((select rating from public.player_ratings where user_id = v_user), 1000)
    ),
    'recent', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'matchId', h.match_id,
        'opponent', p.username,
        'opponentAvatar', p.avatar_character_id,
        'score', h.score,
        'opponentScore', h.opponent_score,
        'outcome', h.outcome,
        'ratingBefore', h.rating_before,
        'ratingAfter', h.rating_after,
        'finishedAt', h.finished_at
      ) order by h.finished_at desc), '[]'::jsonb)
      from (
        select * from public.pvp_match_history
        where user_id = v_user order by finished_at desc limit 10
      ) h
      left join public.profiles p on p.id = h.opponent_id
    )
  );
end;
$$;

grant execute on function public.my_pvp_stats() to authenticated;

/** The ranked ladder. Only players who have actually played appear. */
create or replace function public.rating_leaderboard()
returns table (
  username    text,
  pronouns    text,
  avatar      text,
  rating      int,
  peak_rating int,
  games       int,
  wins        int,
  losses      int,
  draws       int
)
language sql stable security definer set search_path = public as $$
  select p.username, p.pronouns, p.avatar_character_id,
         r.rating, r.peak_rating, r.games, r.wins, r.losses, r.draws
  from public.player_ratings r
  join public.profiles p on p.id = r.user_id
  where r.games > 0
  order by r.rating desc, r.games desc;
$$;

grant execute on function public.rating_leaderboard() to authenticated;

-- Backfill ratings for everyone who already has an account.
insert into public.player_ratings (user_id)
select id from public.profiles
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Expose ranked on match state
-- ---------------------------------------------------------------------------
-- Only the flag is added; everything else is the definition from 13.
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
