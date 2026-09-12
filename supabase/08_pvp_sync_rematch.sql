-- BOTC Wordle: synchronised round starts and rematch.
-- Run AFTER 07_endless_collection_tiers_stats.sql. Safe to re-run.

-- ===========================================================================
-- 1. Synchronised starts
-- ===========================================================================
-- The problem: a round became live the instant it was inserted, and each client
-- found out whenever its own notification arrived. On one machine running two
-- browsers that gap was very visible, and in a thirty second race a second of
-- it is a real advantage.
--
-- The fix is a lead-in. A round is created with starts_at a few seconds in the
-- future, so both clients receive it BEFORE it matters and reveal on a shared
-- deadline rather than on arrival. Anything slower than the lead-in is still
-- late, but ordinary delivery jitter disappears completely.
--
-- Elapsed time is measured from starts_at, so a slow delivery cannot cost
-- points either.
alter table public.pvp_rounds add column if not exists starts_at timestamptz;

-- Existing rounds: treat the old start as the reveal time.
update public.pvp_rounds set starts_at = started_at where starts_at is null;

/** Seconds of lead-in before a round becomes playable. */
create or replace function public.pvp_lead_in()
returns interval language sql immutable as $$ select interval '3 seconds' $$;

create or replace function public.pvp_open_round(p_match uuid, p_cycle int, p_round int)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_used  text[];
  v_char  text;
  v_round uuid;
  v_kind  text := case p_round when 1 then 'icon' when 2 then 'race' else 'assigned' end;
  v_user  record;
  v_start timestamptz;
begin
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

  if v_round is null then return; end if;

  if v_kind = 'assigned' then
    return;  -- pvp_assign starts the clock once both have picked
  end if;

  v_char := public.pvp_pick_character(p_match, v_used);
  v_start := now() + public.pvp_lead_in();

  for v_user in select user_id from public.pvp_participants where match_id = p_match loop
    insert into public.pvp_round_answers (round_id, user_id, character_id)
    values (v_round, v_user.user_id, v_char)
    on conflict do nothing;
  end loop;

  update public.pvp_rounds
  set started_at = v_start,
      starts_at  = v_start,
      ends_at    = v_start + case when v_kind = 'icon' then interval '30 seconds'
                                  else interval '5 minutes' end
  where id = v_round;
end;
$$;

create or replace function public.pvp_assign(p_round uuid, p_character_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user  uuid := auth.uid();
  v_round public.pvp_rounds;
  v_opp   uuid;
  v_ready int;
  v_start timestamptz;
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

  select count(*) into v_ready from public.pvp_round_answers where round_id = p_round;
  if v_ready >= 2 then
    v_start := now() + public.pvp_lead_in();
    update public.pvp_rounds
    set started_at = v_start, starts_at = v_start,
        ends_at = v_start + interval '5 minutes',
        state = '{"phase":"playing"}'::jsonb
    where id = p_round and starts_at is null;
  end if;
end;
$$;

-- Submissions are measured from the shared reveal time and refused before it.
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

  -- Nobody can answer before the token is revealed to both players.
  if v_round.starts_at is not null and now() < v_round.starts_at then
    return jsonb_build_object('verdict', 'early');
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

  insert into public.pvp_round_results (round_id, user_id)
  values (p_round, v_user) on conflict (round_id, user_id) do nothing;

  update public.pvp_round_results
  set guesses = guesses || jsonb_build_array(jsonb_build_object('text', p_text)),
      guess_count = guess_count + 1
  where round_id = p_round and user_id = v_user;

  if v_norm = v_answer.norm_name then
    v_elapsed := greatest(0, (extract(epoch from (now() - coalesce(v_round.starts_at, v_round.started_at))) * 1000)::int);
    v_points := public.pvp_score_icon(v_elapsed);

    update public.pvp_round_results
    set solved = true, points = v_points, elapsed_ms = v_elapsed, finished_at = now()
    where round_id = p_round and user_id = v_user;

    update public.pvp_participants set score = score + v_points
    where match_id = v_round.match_id and user_id = v_user;

    perform public.record_collection(v_user, v_answer.id, 'pvp');

    return jsonb_build_object('verdict', 'correct', 'points', v_points,
                              'elapsedMs', v_elapsed, 'answerName', v_answer.name);
  end if;

  if exists (select 1 from public.characters where norm_name = v_norm) then
    return jsonb_build_object('verdict', 'wrong');
  end if;

  v_dist := levenshtein(v_norm, v_answer.norm_name);
  v_allowed := case when length(v_answer.norm_name) <= 6 then 1 else 2 end;
  return jsonb_build_object('verdict', case when v_dist <= v_allowed then 'close' else 'wrong' end);
end;
$$;

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
  if v_round.starts_at is not null and now() < v_round.starts_at then
    return jsonb_build_object('early', true);
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
  if v_row.guess_count >= 8 then return jsonb_build_object('capped', true); end if;

  v_clue := public.botc_compare(v_guess.attrs, v_answer.attrs);
  v_solved := v_guess.id = v_answer.id;
  v_count := v_row.guess_count + 1;

  update public.pvp_round_results
  set guesses = guesses || jsonb_build_array(
        jsonb_build_object('id', v_guess.id, 'name', v_guess.name, 'clue', v_clue)),
      guess_count = v_count,
      solved = v_solved,
      elapsed_ms = greatest(0, (extract(epoch from (now() - coalesce(v_round.starts_at, v_round.started_at))) * 1000)::int),
      finished_at = case when v_solved or v_count >= 8 then now() else null end
  where round_id = p_round and user_id = v_user
  returning * into v_row;

  if v_solved then
    v_points := public.pvp_score_guesses(v_count, true, 1);
    update public.pvp_round_results set points = v_points
    where round_id = p_round and user_id = v_user;
    update public.pvp_participants set score = score + v_points
    where match_id = v_round.match_id and user_id = v_user;
    perform public.record_collection(v_user, v_answer.id, 'pvp');
  end if;

  return jsonb_build_object(
    'clue', v_clue, 'guessId', v_guess.id, 'guessName', v_guess.name,
    'solved', v_solved, 'guessCount', v_count,
    'answerName', case when v_solved or v_count >= 4 then v_answer.name else null end,
    'answerId', case when v_solved or v_count >= 8 then v_answer.id else null end
  );
end;
$$;

-- Rounds must not be closed before they have even begun.
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
  if v_round.starts_at is null then return; end if;      -- still picking
  if now() < v_round.starts_at then return; end if;      -- still in the lead-in

  select count(*) into v_players from public.pvp_participants where match_id = p_match;
  select count(*) into v_done from public.pvp_round_results
  where round_id = v_round.id and finished_at is not null;

  if v_done < v_players and now() < v_round.ends_at then return; end if;

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

-- ===========================================================================
-- 2. Rematch
-- ===========================================================================
/**
 * Creates a fresh match with the same two players and the same settings, and
 * records it on the finished match so the other player is taken there too
 * rather than having to be sent a new code.
 */
create or replace function public.pvp_rematch(p_match uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user  uuid := auth.uid();
  v_old   public.pvp_matches;
  v_code  text;
  v_new   uuid;
  v_existing uuid;
  r record;
begin
  if v_user is null then raise exception 'Not signed in'; end if;

  select * into v_old from public.pvp_matches where id = p_match for update;
  if not found then raise exception 'No such match'; end if;
  if not exists (select 1 from public.pvp_participants
                 where match_id = p_match and user_id = v_user) then
    raise exception 'Not in this match';
  end if;

  -- If the opponent already asked for a rematch, join theirs instead of
  -- opening a second one and stranding the two of you in separate lobbies.
  v_existing := (v_old.config ->> 'rematchId')::uuid;
  if v_existing is not null and exists (select 1 from public.pvp_matches where id = v_existing) then
    insert into public.pvp_participants (match_id, user_id)
    values (v_existing, v_user) on conflict do nothing;
    return jsonb_build_object('matchId', v_existing);
  end if;

  loop
    select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                             (random() * 31)::int + 1, 1), '')
    into v_code from generate_series(1, 6);
    exit when not exists (select 1 from public.pvp_matches where join_code = v_code);
  end loop;

  insert into public.pvp_matches (join_code, host_id, cycles, config)
  values (v_code, v_user, v_old.cycles, v_old.config - 'rematchId')
  returning id into v_new;

  -- Both players carried over, so nobody has to re-enter a code.
  for r in select user_id from public.pvp_participants where match_id = p_match loop
    insert into public.pvp_participants (match_id, user_id)
    values (v_new, r.user_id) on conflict do nothing;
  end loop;

  update public.pvp_matches
  set config = config || jsonb_build_object('rematchId', v_new), updated_at = now()
  where id = p_match;

  return jsonb_build_object('matchId', v_new, 'joinCode', v_code);
end;
$$;

grant execute on function public.pvp_rematch(uuid) to authenticated;

-- pvp_state gains the reveal time and any rematch the opponent has opened.
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
    'isHost', v_match.host_id = v_user,
    'config', v_match.config,
    'cycles', v_match.cycles,
    'currentCycle', v_match.current_cycle,
    'currentRound', v_match.current_round,
    'rematchId', v_match.config ->> 'rematchId',
    'serverNow', now(),
    'players', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'userId', p.user_id, 'username', pr.username, 'avatar', pr.avatar_character_id,
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
      -- Sent during the lead-in so the image is already cached when the round
      -- goes live; the client keeps it hidden until then.
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
