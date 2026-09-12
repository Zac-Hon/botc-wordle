-- BOTC Wordle: time counts in the deduction rounds.
-- Run AFTER 11_storyteller_tier.sql. Safe to re-run.
--
-- Rounds two and three scored on guesses alone, so three guesses in twenty
-- seconds paid exactly what three guesses in four minutes paid and the clock
-- may as well not have been running. They now weigh economy and speed equally.
--
-- Mirrors src/game/scoring.ts. scripts/verify-parity.ts checks the two agree
-- across every combination, which is the only thing keeping them honest.

-- Gains an elapsed-time parameter, so the old signature has to go first.
drop function if exists public.pvp_score_guesses(int, bool, numeric);
drop function if exists public.pvp_score_guesses(int, bool, numeric, int);

/**
 * Speed stops earning past this. The round runs for five minutes, but scaling
 * against that would put every realistic solve at the top of the curve and
 * separate nobody.
 */
create or replace function public.pvp_speed_reference_ms()
returns int language sql immutable as $$ select 120000 $$;

create or replace function public.pvp_score_guesses(
  p_guesses       int,
  p_solved        bool,
  p_best_fraction numeric,
  p_elapsed_ms    int default null
)
returns numeric language sql immutable as $$
  select case
    when not p_solved then round(40 * greatest(0, least(1, coalesce(p_best_fraction, 0))))
    else round(
      -- Floor, above the 40 an unsolved round can reach: solving must never
      -- pay less than failing.
      50
      -- Up to 25 for economy of guesses.
      + 25 * ((8 - greatest(1, least(coalesce(p_guesses, 1), 8)))::numeric / 7)
      -- Up to 25 for speed. A missing elapsed time scores no bonus rather than
      -- a full one, so an unmeasured solve cannot beat a measured fast one.
      + 25 * greatest(0, least(1,
          1 - (greatest(0, coalesce(p_elapsed_ms, public.pvp_speed_reference_ms()))::numeric
               / public.pvp_speed_reference_ms())))
    )
  end;
$$;

grant execute on function public.pvp_score_guesses(int, bool, numeric, int) to anon, authenticated;
grant execute on function public.pvp_speed_reference_ms() to anon, authenticated;

-- The callers must now pass the elapsed time through.
create or replace function public.pvp_submit_guess(p_round uuid, p_guess_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user    uuid := auth.uid();
  v_round   public.pvp_rounds;
  v_answer  public.characters;
  v_guess   public.characters;
  v_clue    jsonb;
  v_solved  bool;
  v_row     public.pvp_round_results;
  v_count   int;
  v_points  numeric;
  v_elapsed int;
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
  -- Measured from the shared reveal, so a slow update cannot cost points.
  v_elapsed := greatest(0, (extract(epoch from
    (now() - coalesce(v_round.starts_at, v_round.started_at))) * 1000)::int);

  update public.pvp_round_results
  set guesses = guesses || jsonb_build_array(
        jsonb_build_object('id', v_guess.id, 'name', v_guess.name, 'clue', v_clue)),
      guess_count = v_count,
      solved = v_solved,
      elapsed_ms = v_elapsed,
      finished_at = case when v_solved or v_count >= 8 then now() else null end
  where round_id = p_round and user_id = v_user
  returning * into v_row;

  if v_solved then
    v_points := public.pvp_score_guesses(v_count, true, 1, v_elapsed);
    update public.pvp_round_results set points = v_points
    where round_id = p_round and user_id = v_user;
    update public.pvp_participants set score = score + v_points
    where match_id = v_round.match_id and user_id = v_user;
    perform public.record_collection(v_user, v_answer.id, 'pvp');
  end if;

  return jsonb_build_object(
    'clue', v_clue, 'guessId', v_guess.id, 'guessName', v_guess.name,
    'solved', v_solved, 'guessCount', v_count, 'elapsedMs', v_elapsed,
    'points', coalesce(v_points, 0),
    'answerName', case when v_solved or v_count >= 4 then v_answer.name else null end,
    'answerId', case when v_solved or v_count >= 8 then v_answer.id else null end
  );
end;
$$;

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
  if v_round.starts_at is null then return; end if;
  if now() < v_round.starts_at then return; end if;

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
          else public.pvp_score_guesses(
                 res.guess_count, false, public.pvp_best_fraction(res.guesses), res.elapsed_ms)
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

grant execute on function public.pvp_submit_guess(uuid, text) to authenticated;
grant execute on function public.pvp_advance(uuid) to authenticated;
