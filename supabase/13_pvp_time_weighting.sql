-- BOTC Wordle: heavier time weighting in Versus.
-- Run AFTER 12_pvp_time_scoring.sql. Safe to re-run.
--
-- The first pass gave speed 25 points across a 120 second window, which is a
-- fifth of a point a second: technically weighted, practically invisible. Speed
-- is now the largest single component and the window is tighter, so a second is
-- worth half a point and twenty seconds of hesitation costs ten.
--
--   deduction solve = 30 floor + up to 25 for economy + up to 45 for speed
--   unsolved        = up to 25, scaled by how much of the clue row matched
--   icon round      = 100 down to 25 across its 30 seconds
--
-- The floor dropped from 50 to 30 to make room, and the unsolved ceiling from
-- 40 to 25 so that solving still beats failing at every point.
--
-- Mirrors src/game/scoring.ts. scripts/verify-parity.ts is what keeps them in
-- step; run it after applying this.

create or replace function public.pvp_speed_reference_ms()
returns int language sql immutable as $$ select 90000 $$;

create or replace function public.pvp_score_icon(p_elapsed_ms int)
returns numeric language sql immutable as $$
  select case
    when p_elapsed_ms >= 30000 then 0
    else round(25 + 75 * ((30000 - greatest(p_elapsed_ms, 0))::numeric / 30000))
  end;
$$;

create or replace function public.pvp_score_guesses(
  p_guesses       int,
  p_solved        bool,
  p_best_fraction numeric,
  p_elapsed_ms    int default null
)
returns numeric language sql immutable as $$
  select case
    when not p_solved then round(25 * greatest(0, least(1, coalesce(p_best_fraction, 0))))
    else round(
      -- Floor, above the 25 an unsolved round can reach.
      30
      -- Up to 25 for economy of guesses.
      + 25 * ((8 - greatest(1, least(coalesce(p_guesses, 1), 8)))::numeric / 7)
      -- Up to 45 for speed, the largest share. A missing elapsed time scores no
      -- bonus rather than a full one, so an unmeasured solve cannot beat a
      -- measured fast one.
      + 45 * greatest(0, least(1,
          1 - (greatest(0, coalesce(p_elapsed_ms, public.pvp_speed_reference_ms()))::numeric
               / public.pvp_speed_reference_ms())))
    )
  end;
$$;

grant execute on function public.pvp_score_icon(int) to anon, authenticated;
grant execute on function public.pvp_score_guesses(int, bool, numeric, int) to anon, authenticated;
grant execute on function public.pvp_speed_reference_ms() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Show the opponent properly in the lobby and on the scoreboard
-- ---------------------------------------------------------------------------
-- pvp_state already carried each player's avatar. It now carries pronouns too,
-- so you can see who you are actually playing rather than a bare username.
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
        'userId', p.user_id,
        'username', pr.username,
        'pronouns', pr.pronouns,
        'avatar', pr.avatar_character_id,
        'score', p.score,
        'ready', p.ready,
        'isHost', p.user_id = v_match.host_id,
        'isMe', p.user_id = v_user
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
