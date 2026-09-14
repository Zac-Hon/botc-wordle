-- BOTC Wordle -- PvP. Run AFTER 04_archive.sql. Safe to re-run.
--
-- Everything that decides a score lives here rather than in the client: who
-- buzzed first, how many guesses it took, whether a typed name was close. A
-- client that can award its own points is a client that can cheat, and this is
-- a head-to-head mode played between friends who will absolutely try.

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
  if v_max is not null and v_max > 5 then
    raise exception 'Refusing to run 05_pvp.sql: migration % is already applied. Apply the numbered files in order, or not at all.', v_max;
  end if;
end
$guard$;


-- Levenshtein, for judging near-miss spellings in the icon round.
create extension if not exists fuzzystrmatch;

-- ---------------------------------------------------------------------------
-- Schema additions
-- ---------------------------------------------------------------------------

-- Live progress, not just the final tally: rows are upserted as a player guesses.
--
-- An earlier 01_schema.sql declared `guesses` as an integer COUNT. PvP needs the
-- guess LIST under that name, and `add column if not exists` silently does
-- nothing when the name is taken, which left coalesce(integer, jsonb) to fail at
-- runtime. Rename the old column rather than dropping it, so nothing is lost.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'pvp_round_results'
      and column_name = 'guesses' and data_type <> 'jsonb'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'pvp_round_results'
      and column_name = 'guess_count'
  ) then
    alter table public.pvp_round_results rename column guesses to guess_count;
  end if;
end
$$;

-- If the rename did not apply (fresh install, or an odd half-state), make sure
-- both columns exist with the right types.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'pvp_round_results'
      and column_name = 'guesses' and data_type <> 'jsonb'
  ) then
    alter table public.pvp_round_results drop column guesses;
  end if;
end
$$;

alter table public.pvp_round_results
  add column if not exists guess_count int not null default 0;
alter table public.pvp_round_results
  add column if not exists guesses jsonb not null default '[]'::jsonb;
alter table public.pvp_round_results
  add column if not exists finished_at timestamptz;

-- Comparable form of each name, so the icon round can judge spelling without
-- recomputing it for 181 rows on every keystroke.
alter table public.characters
  add column if not exists norm_name text;

update public.characters
set norm_name = lower(regexp_replace(name, '[^A-Za-z0-9]', '', 'g'))
where norm_name is null;

create index if not exists characters_norm_name_idx on public.characters (norm_name);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.pvp_norm(p_text text)
returns text language sql immutable as $$
  select lower(regexp_replace(coalesce(p_text, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

/** Mirrors src/game/scoring.ts: 100 at instant recognition down to 40 at the buzzer. */
create or replace function public.pvp_score_icon(p_elapsed_ms int)
returns numeric language sql immutable as $$
  select case
    when p_elapsed_ms >= 30000 then 0
    else round(40 + 60 * ((30000 - greatest(p_elapsed_ms, 0))::numeric / 30000))
  end;
$$;

/**
 * Mirrors src/game/scoring.ts. A solve at the eight-guess cap scores 51, which
 * still beats the best possible unsolved score of 40 -- solving must never pay
 * less than failing.
 */
create or replace function public.pvp_score_guesses(
  p_guesses int, p_solved bool, p_best_fraction numeric
)
returns numeric language sql immutable as $$
  select case
    when p_solved then 100 - (greatest(p_guesses, 1) - 1) * 7
    else round(40 * greatest(0, least(1, coalesce(p_best_fraction, 0))))
  end;
$$;

/** Best fraction of clue cells matched across a player's guesses so far. */
create or replace function public.pvp_best_fraction(p_guesses jsonb)
returns numeric language sql stable as $$
  select coalesce(max(frac), 0) from (
    select (
      select sum(case c ->> 'result' when 'match' then 1.0 when 'partial' then 0.5 else 0 end)
             / nullif(count(*), 0)
      from jsonb_array_elements(coalesce(g -> 'clue', '[]'::jsonb)) c
    ) as frac
    from jsonb_array_elements(coalesce(p_guesses, '[]'::jsonb)) g
  ) t;
$$;

/** The other player in a two-person match. */
create or replace function public.pvp_opponent(p_match uuid, p_user uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select user_id from public.pvp_participants
  where match_id = p_match and user_id <> p_user
  limit 1;
$$;

/** Draws a character for a match, honouring its pool toggles. */
create or replace function public.pvp_pick_character(p_match uuid, p_exclude text[] default '{}')
returns text language plpgsql stable security definer set search_path = public as $$
declare
  cfg jsonb;
  pick text;
begin
  select config into cfg from public.pvp_matches where id = p_match;

  select c.id into pick
  from public.characters c
  where not (c.pools ->> 'isStoryteller')::bool          -- never in PvP, by design
    and not (c.id = any(p_exclude))
    and (
      ((cfg ->> 'base3')::bool        and (c.pools ->> 'inBase3')::bool)
      or ((cfg ->> 'experimental')::bool and (c.pools ->> 'isExperimental')::bool)
    )
    and ((cfg ->> 'travellers')::bool or not (c.pools ->> 'isTraveller')::bool)
  order by random()
  limit 1;

  -- A pool that excludes everything would stall the match; fall back to base 3.
  if pick is null then
    select c.id into pick from public.characters c
    where (c.pools ->> 'inBase3')::bool and not (c.id = any(p_exclude))
    order by random() limit 1;
  end if;

  return pick;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lobby
-- ---------------------------------------------------------------------------

create or replace function public.pvp_create(p_cycles int default 1)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_code text;
  v_id   uuid;
begin
  if v_user is null then raise exception 'Not signed in'; end if;

  -- Unambiguous alphabet: no O/0, I/1, so a code read aloud is not a puzzle.
  loop
    select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                             (random() * 31)::int + 1, 1), '')
    into v_code
    from generate_series(1, 6);
    exit when not exists (select 1 from public.pvp_matches where join_code = v_code);
  end loop;

  insert into public.pvp_matches (join_code, host_id, cycles, config)
  values (
    v_code, v_user, greatest(1, least(3, coalesce(p_cycles, 1))),
    '{"base3": true, "experimental": true, "travellers": false}'::jsonb
  )
  returning id into v_id;

  insert into public.pvp_participants (match_id, user_id) values (v_id, v_user);

  return jsonb_build_object('matchId', v_id, 'joinCode', v_code);
end;
$$;

create or replace function public.pvp_join(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_match public.pvp_matches;
  v_count int;
begin
  if v_user is null then raise exception 'Not signed in'; end if;

  select * into v_match from public.pvp_matches
  where join_code = upper(trim(p_code)) for update;

  if not found then raise exception 'No match with that code'; end if;
  if v_match.status <> 'lobby' then raise exception 'That match has already started'; end if;

  select count(*) into v_count from public.pvp_participants where match_id = v_match.id;
  if v_count >= 2 and not exists (
    select 1 from public.pvp_participants where match_id = v_match.id and user_id = v_user
  ) then
    raise exception 'That match is full';
  end if;

  insert into public.pvp_participants (match_id, user_id)
  values (v_match.id, v_user)
  on conflict (match_id, user_id) do nothing;

  return jsonb_build_object('matchId', v_match.id, 'joinCode', v_match.join_code);
end;
$$;

create or replace function public.pvp_configure(p_match uuid, p_config jsonb, p_cycles int)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  update public.pvp_matches
  set config = coalesce(p_config, config),
      cycles = greatest(1, least(3, coalesce(p_cycles, cycles))),
      updated_at = now()
  where id = p_match and host_id = v_user and status = 'lobby';

  if not found then raise exception 'Only the host can configure a match in the lobby'; end if;
end;
$$;

create or replace function public.pvp_set_ready(p_match uuid, p_ready bool)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.pvp_participants set ready = coalesce(p_ready, false)
  where match_id = p_match and user_id = auth.uid();
  update public.pvp_matches set updated_at = now() where id = p_match;
end;
$$;

/** Creates the next round, or finishes the match when the cycles run out. */
create or replace function public.pvp_open_round(p_match uuid, p_cycle int, p_round int)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_used text[];
  v_char text;
  v_round uuid;
  v_kind text := case p_round when 1 then 'icon' when 2 then 'race' else 'assigned' end;
  v_user record;
begin
  -- Never repeat a character inside one match.
  select coalesce(array_agg(a.character_id), '{}') into v_used
  from public.pvp_round_answers a
  join public.pvp_rounds r on r.id = a.round_id
  where r.match_id = p_match;

  insert into public.pvp_rounds (match_id, cycle, round_no, kind, state)
  values (p_match, p_cycle, p_round, v_kind,
          case when v_kind = 'assigned' then '{"phase":"picking"}'::jsonb
               else '{"phase":"playing"}'::jsonb end)
  on conflict (match_id, cycle, round_no) do nothing
  returning id into v_round;

  if v_round is null then return; end if;  -- already open

  if v_kind = 'assigned' then
    -- Players choose for each other first; pvp_assign starts the clock.
    return;
  end if;

  -- Icon and race rounds: one shared character, revealed to both at once.
  v_char := public.pvp_pick_character(p_match, v_used);

  for v_user in select user_id from public.pvp_participants where match_id = p_match loop
    insert into public.pvp_round_answers (round_id, user_id, character_id)
    values (v_round, v_user.user_id, v_char)
    on conflict do nothing;
  end loop;

  update public.pvp_rounds
  set started_at = now(),
      ends_at = now() + case when v_kind = 'icon' then interval '30 seconds'
                             else interval '5 minutes' end
  where id = v_round;
end;
$$;

create or replace function public.pvp_start(p_match uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_match public.pvp_matches;
  v_ready int;
begin
  select * into v_match from public.pvp_matches where id = p_match for update;
  if not found then raise exception 'No such match'; end if;
  if v_match.host_id <> v_user then raise exception 'Only the host can start'; end if;
  if v_match.status <> 'lobby' then return; end if;

  select count(*) into v_ready from public.pvp_participants
  where match_id = p_match and ready;
  if v_ready < 2 then raise exception 'Both players must be ready'; end if;

  update public.pvp_matches
  set status = 'active', current_cycle = 1, current_round = 1, updated_at = now()
  where id = p_match;

  perform public.pvp_open_round(p_match, 1, 1);
end;
$$;

-- ---------------------------------------------------------------------------
-- Playing
-- ---------------------------------------------------------------------------

/**
 * Judges a typed name in the icon round.
 *
 * Returns 'correct', 'close' or 'wrong' and never the answer -- a near miss is
 * told it is near and nothing more, so the player still has to produce the
 * spelling. Naming a DIFFERENT real character is always 'wrong', never 'close':
 * Butler and Butcher are two edits apart, and answering "so close!" there would
 * confirm a character the player had not earned.
 */
create or replace function public.pvp_submit_icon_guess(p_round uuid, p_text text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user    uuid := auth.uid();
  v_round   public.pvp_rounds;
  v_answer  public.characters;
  v_norm    text := public.pvp_norm(p_text);
  v_dist    int;
  v_allowed int;
  v_elapsed int;
  v_points  numeric;
  v_result  public.pvp_round_results;
begin
  select * into v_round from public.pvp_rounds where id = p_round;
  if not found then raise exception 'No such round'; end if;
  if not exists (select 1 from public.pvp_participants
                 where match_id = v_round.match_id and user_id = v_user) then
    raise exception 'Not in this match';
  end if;

  select c.* into v_answer
  from public.pvp_round_answers a
  join public.characters c on c.id = a.character_id
  where a.round_id = p_round and a.user_id = v_user;

  select * into v_result from public.pvp_round_results
  where round_id = p_round and user_id = v_user;

  if v_result.solved then return jsonb_build_object('verdict', 'correct', 'alreadyScored', true); end if;
  if v_round.ends_at is not null and now() > v_round.ends_at then
    return jsonb_build_object('verdict', 'expired');
  end if;
  if length(v_norm) = 0 then return jsonb_build_object('verdict', 'wrong'); end if;

  insert into public.pvp_round_results (round_id, user_id, guesses, guess_count)
  values (p_round, v_user, '[]'::jsonb, 0)
  on conflict (round_id, user_id) do nothing;

  update public.pvp_round_results
  set guesses = guesses || jsonb_build_array(jsonb_build_object('text', p_text)),
      guess_count = guess_count + 1
  where round_id = p_round and user_id = v_user;

  if v_norm = v_answer.norm_name then
    v_elapsed := greatest(0, (extract(epoch from (now() - v_round.started_at)) * 1000)::int);
    v_points := public.pvp_score_icon(v_elapsed);

    update public.pvp_round_results
    set solved = true, points = v_points, elapsed_ms = v_elapsed, finished_at = now()
    where round_id = p_round and user_id = v_user;

    update public.pvp_participants
    set score = score + v_points
    where match_id = v_round.match_id and user_id = v_user;

    return jsonb_build_object('verdict', 'correct', 'points', v_points,
                              'elapsedMs', v_elapsed, 'answerName', v_answer.name);
  end if;

  -- A different real character is a wrong answer, not a typo.
  if exists (select 1 from public.characters where norm_name = v_norm) then
    return jsonb_build_object('verdict', 'wrong');
  end if;

  v_dist := levenshtein(v_norm, v_answer.norm_name);
  v_allowed := case when length(v_answer.norm_name) <= 6 then 1 else 2 end;

  return jsonb_build_object('verdict', case when v_dist <= v_allowed then 'close' else 'wrong' end);
end;
$$;

/** A deduction-round guess. Returns the clue row; the answer stays hidden. */
create or replace function public.pvp_submit_guess(p_round uuid, p_guess_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user   uuid := auth.uid();
  v_round  public.pvp_rounds;
  v_answer public.characters;
  v_guess  public.characters;
  v_clue   jsonb;
  v_solved bool;
  v_row    public.pvp_round_results;
  v_count  int;
  v_points numeric;
begin
  select * into v_round from public.pvp_rounds where id = p_round;
  if not found then raise exception 'No such round'; end if;
  if not exists (select 1 from public.pvp_participants
                 where match_id = v_round.match_id and user_id = v_user) then
    raise exception 'Not in this match';
  end if;
  if v_round.ends_at is not null and now() > v_round.ends_at then
    return jsonb_build_object('expired', true);
  end if;

  select c.* into v_answer
  from public.pvp_round_answers a
  join public.characters c on c.id = a.character_id
  where a.round_id = p_round and a.user_id = v_user;
  if not found then raise exception 'This round has no character yet'; end if;

  select * into v_guess from public.characters where id = p_guess_id;
  if not found then raise exception 'Unknown character'; end if;

  insert into public.pvp_round_results (round_id, user_id)
  values (p_round, v_user) on conflict (round_id, user_id) do nothing;

  select * into v_row from public.pvp_round_results
  where round_id = p_round and user_id = v_user for update;

  if v_row.solved or v_row.finished_at is not null then
    return jsonb_build_object('finished', true);
  end if;
  if v_row.guess_count >= 8 then
    return jsonb_build_object('capped', true);
  end if;

  v_clue := public.botc_compare(v_guess.attrs, v_answer.attrs);
  v_solved := v_guess.id = v_answer.id;
  v_count := v_row.guess_count + 1;

  update public.pvp_round_results
  set guesses = guesses || jsonb_build_array(
        jsonb_build_object('id', v_guess.id, 'name', v_guess.name, 'clue', v_clue)),
      guess_count = v_count,
      solved = v_solved,
      elapsed_ms = greatest(0, (extract(epoch from (now() - v_round.started_at)) * 1000)::int),
      finished_at = case when v_solved or v_count >= 8 then now() else null end
  where round_id = p_round and user_id = v_user
  returning * into v_row;

  if v_solved then
    v_points := public.pvp_score_guesses(v_count, true, 1);
    update public.pvp_round_results set points = v_points
    where round_id = p_round and user_id = v_user;
    update public.pvp_participants set score = score + v_points
    where match_id = v_round.match_id and user_id = v_user;
  end if;

  return jsonb_build_object(
    'clue', v_clue,
    'guessId', v_guess.id,
    'guessName', v_guess.name,
    'solved', v_solved,
    'guessCount', v_count,
    'answerName', case
      when v_solved or v_count >= 4 then v_answer.name else null end,
    'answerId', case when v_solved or v_count >= 8 then v_answer.id else null end
  );
end;
$$;

/** Round 3: choose the character your OPPONENT has to find. */
create or replace function public.pvp_assign(p_round uuid, p_character_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_round public.pvp_rounds;
  v_opp uuid;
  v_ready int;
begin
  select * into v_round from public.pvp_rounds where id = p_round for update;
  if not found then raise exception 'No such round'; end if;
  if v_round.kind <> 'assigned' then raise exception 'That round is not a pick round'; end if;

  v_opp := public.pvp_opponent(v_round.match_id, v_user);
  if v_opp is null then raise exception 'No opponent yet'; end if;

  if not exists (select 1 from public.characters
                 where id = p_character_id and not (pools ->> 'isStoryteller')::bool) then
    raise exception 'Not a valid character for PvP';
  end if;

  insert into public.pvp_round_answers (round_id, user_id, character_id)
  values (p_round, v_opp, p_character_id)
  on conflict (round_id, user_id) do update set character_id = excluded.character_id;

  -- Start the clock only once both have picked, so neither gets a head start.
  select count(*) into v_ready from public.pvp_round_answers where round_id = p_round;
  if v_ready >= 2 then
    update public.pvp_rounds
    set started_at = now(), ends_at = now() + interval '5 minutes',
        state = '{"phase":"playing"}'::jsonb
    where id = p_round and started_at is null;
  end if;
end;
$$;

/**
 * Closes a finished round and opens the next, or ends the match.
 *
 * Idempotent and callable by either player, which is how rounds advance without
 * a scheduler -- the free tier has no cron, and relying on one client to be the
 * timekeeper breaks the moment they close the tab.
 */
create or replace function public.pvp_advance(p_match uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_match public.pvp_matches;
  v_round public.pvp_rounds;
  v_players int;
  v_done int;
  v_next_cycle int;
  v_next_round int;
  r record;
begin
  select * into v_match from public.pvp_matches where id = p_match for update;
  if not found or v_match.status <> 'active' then return; end if;

  select * into v_round from public.pvp_rounds
  where match_id = p_match and cycle = v_match.current_cycle and round_no = v_match.current_round;
  if not found then return; end if;

  -- A pick round that nobody has completed yet is simply waiting.
  if v_round.started_at is null then return; end if;

  select count(*) into v_players from public.pvp_participants where match_id = p_match;
  select count(*) into v_done from public.pvp_round_results
  where round_id = v_round.id and finished_at is not null;

  if v_done < v_players and now() < v_round.ends_at then return; end if;

  -- Settle anyone who ran out of time: they still score for how close they got.
  for r in select p.user_id from public.pvp_participants p where p.match_id = p_match loop
    insert into public.pvp_round_results (round_id, user_id)
    values (v_round.id, r.user_id) on conflict do nothing;

    update public.pvp_round_results res
    set points = case
          when res.solved then res.points
          when v_round.kind = 'icon' then 0
          else public.pvp_score_guesses(res.guess_count, false, public.pvp_best_fraction(res.guesses))
        end,
        finished_at = coalesce(res.finished_at, now())
    where res.round_id = v_round.id and res.user_id = r.user_id and res.finished_at is null;
  end loop;

  -- Fold the unsolved points into the running totals exactly once.
  update public.pvp_participants p
  set score = p.score + coalesce((
    select res.points from public.pvp_round_results res
    where res.round_id = v_round.id and res.user_id = p.user_id and not res.solved
  ), 0)
  where p.match_id = p_match
    and not exists (
      select 1 from public.pvp_round_results res
      where res.round_id = v_round.id and res.user_id = p.user_id and res.solved
    );

  -- Advance.
  if v_match.current_round < 3 then
    v_next_cycle := v_match.current_cycle;
    v_next_round := v_match.current_round + 1;
  elsif v_match.current_cycle < v_match.cycles then
    v_next_cycle := v_match.current_cycle + 1;
    v_next_round := 1;
  else
    update public.pvp_matches set status = 'finished', updated_at = now() where id = p_match;
    return;
  end if;

  update public.pvp_matches
  set current_cycle = v_next_cycle, current_round = v_next_round, updated_at = now()
  where id = p_match;

  perform public.pvp_open_round(p_match, v_next_cycle, v_next_round);
end;
$$;

-- ---------------------------------------------------------------------------
-- State
-- ---------------------------------------------------------------------------

/** Everything the client needs, with nothing it must not see. */
create or replace function public.pvp_state(p_match uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user  uuid := auth.uid();
  v_match public.pvp_matches;
  v_round public.pvp_rounds;
  v_mine  public.pvp_round_results;
  v_answer public.characters;
  v_finished bool;
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

  v_finished := v_match.status = 'finished'
                or (v_mine.finished_at is not null)
                or (v_round.ends_at is not null and now() > v_round.ends_at);

  return jsonb_build_object(
    'matchId', v_match.id,
    'joinCode', v_match.join_code,
    'status', v_match.status,
    'isHost', v_match.host_id = v_user,
    'config', v_match.config,
    'cycles', v_match.cycles,
    'currentCycle', v_match.current_cycle,
    'currentRound', v_match.current_round,
    'players', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'userId', p.user_id, 'username', pr.username,
        'score', p.score, 'ready', p.ready, 'isMe', p.user_id = v_user
      ) order by p.joined_at), '[]'::jsonb)
      from public.pvp_participants p
      join public.profiles pr on pr.id = p.user_id
      where p.match_id = p_match
    ),
    'round', case when v_round.id is null then null else jsonb_build_object(
      'id', v_round.id,
      'kind', v_round.kind,
      'cycle', v_round.cycle,
      'roundNo', v_round.round_no,
      'phase', v_round.state ->> 'phase',
      'startedAt', v_round.started_at,
      'endsAt', v_round.ends_at,
      'serverNow', now(),
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
      -- The icon round shows the token from the start; that is the puzzle. The
      -- deduction rounds reveal nothing until the player has earned it.
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

grant execute on function public.pvp_create(int)                       to authenticated;
grant execute on function public.pvp_join(text)                        to authenticated;
grant execute on function public.pvp_configure(uuid, jsonb, int)       to authenticated;
grant execute on function public.pvp_set_ready(uuid, bool)             to authenticated;
grant execute on function public.pvp_start(uuid)                       to authenticated;
grant execute on function public.pvp_submit_icon_guess(uuid, text)     to authenticated;
grant execute on function public.pvp_submit_guess(uuid, text)          to authenticated;
grant execute on function public.pvp_assign(uuid, text)                to authenticated;
grant execute on function public.pvp_advance(uuid)                     to authenticated;
grant execute on function public.pvp_state(uuid)                       to authenticated;

-- Pure scoring helpers, exposed so scripts/verify-parity.ts can prove they agree
-- with src/game/scoring.ts. They take only numbers and reveal nothing.
grant execute on function public.pvp_score_icon(int)                       to anon, authenticated;
grant execute on function public.pvp_score_guesses(int, bool, numeric)     to anon, authenticated;

-- Participants may insert themselves via pvp_join (security definer), but the
-- table also needs a write path for the lobby list to update live.
drop policy if exists pvp_participants_update_own on public.pvp_participants;
create policy pvp_participants_update_own on public.pvp_participants
  for update to authenticated using (user_id = auth.uid());

-- Records this file as applied, for the ordering guard at the top.
insert into public.schema_version (n) values (5) on conflict (n) do nothing;
