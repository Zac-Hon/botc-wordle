-- BOTC Wordle: make the remaining duplicated logic testable.
-- Run AFTER 15_fix_ranked_start.sql. Safe to re-run.
--
-- An audit turned up two pieces of game logic that exist in both TypeScript and
-- SQL, where only the SQL copy actually runs and neither was covered by
-- verify-parity:
--
--   judgeName / the icon-round spelling check
--   matchFraction / pvp_best_fraction
--
-- The TypeScript versions had careful tests, including the one proving that
-- typing "Butler" when the answer is "Butcher" must not be answered "so close".
-- Those tests were protecting code the app never calls. This exposes the live
-- SQL as pure functions so the parity script can hold them to the same standard,
-- turning the TypeScript into the reference implementation rather than
-- decoration.
--
-- It also gives the hangman threshold a single definition on this side, since
-- the value 4 was written out in seven separate places.

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
  if v_max is not null and v_max > 16 then
    raise exception 'Refusing to run 16_parity_hooks.sql: migration % is already applied. Apply the numbered files in order, or not at all.', v_max;
  end if;
end
$guard$;


-- ---------------------------------------------------------------------------
-- Hangman threshold
-- ---------------------------------------------------------------------------
/** Wrong guesses before the name starts revealing. Mirrors HANGMAN_START. */
create or replace function public.hangman_start()
returns int language sql immutable as $$ select 4 $$;

grant execute on function public.hangman_start() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Icon-round spelling judge, as a pure function
-- ---------------------------------------------------------------------------
/**
 * Judges a typed name. Returns 'correct', 'close' or 'wrong'.
 *
 * Pure and exposed so it can be parity-tested: the caller supplies both sides,
 * so it reveals nothing they did not already type. pvp_submit_icon_guess calls
 * this same function, which is what makes testing it meaningful.
 *
 * Naming a DIFFERENT real character is always wrong, never close. Butler and
 * Butcher are two edits apart, and answering "so close" there would confirm a
 * character the player had not earned.
 */
create or replace function public.pvp_judge_name(p_input text, p_answer text)
returns text language plpgsql stable as $$
declare
  v_in  text := public.pvp_norm(p_input);
  v_ans text := public.pvp_norm(p_answer);
  v_allowed int;
begin
  if length(v_in) = 0 then return 'wrong'; end if;
  if v_in = v_ans then return 'correct'; end if;

  if exists (select 1 from public.characters where norm_name = v_in) then
    return 'wrong';
  end if;

  v_allowed := case when length(v_ans) <= 6 then 1 else 2 end;
  return case when levenshtein(v_in, v_ans) <= v_allowed then 'close' else 'wrong' end;
end;
$$;

grant execute on function public.pvp_judge_name(text, text) to anon, authenticated;

grant execute on function public.pvp_best_fraction(jsonb) to anon, authenticated;
grant execute on function public.pvp_norm(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Route the live path through it
-- ---------------------------------------------------------------------------
create or replace function public.pvp_submit_icon_guess(p_round uuid, p_text text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user    uuid := auth.uid();
  v_round   public.pvp_rounds;
  v_answer  public.characters;
  v_verdict text;
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

  if v_result.solved then
    return jsonb_build_object('verdict', 'correct', 'alreadyScored', true);
  end if;
  if v_round.ends_at is not null and now() > v_round.ends_at then
    return jsonb_build_object('verdict', 'expired');
  end if;

  v_verdict := public.pvp_judge_name(p_text, v_answer.name);
  if v_verdict = 'wrong' and length(public.pvp_norm(p_text)) = 0 then
    return jsonb_build_object('verdict', 'wrong');
  end if;

  insert into public.pvp_round_results (round_id, user_id)
  values (p_round, v_user) on conflict (round_id, user_id) do nothing;

  update public.pvp_round_results
  set guesses = guesses || jsonb_build_array(jsonb_build_object('text', p_text)),
      guess_count = guess_count + 1
  where round_id = p_round and user_id = v_user;

  if v_verdict <> 'correct' then
    return jsonb_build_object('verdict', v_verdict);
  end if;

  v_elapsed := greatest(0, (extract(epoch from
    (now() - coalesce(v_round.starts_at, v_round.started_at))) * 1000)::int);
  v_points := public.pvp_score_icon(v_elapsed);

  update public.pvp_round_results
  set solved = true, points = v_points, elapsed_ms = v_elapsed, finished_at = now()
  where round_id = p_round and user_id = v_user;

  update public.pvp_participants set score = score + v_points
  where match_id = v_round.match_id and user_id = v_user;

  perform public.record_collection(v_user, v_answer.id, 'pvp');

  return jsonb_build_object('verdict', 'correct', 'points', v_points,
                            'elapsedMs', v_elapsed, 'answerName', v_answer.name);
end;
$$;

grant execute on function public.pvp_submit_icon_guess(uuid, text) to authenticated;

-- Records this file as applied, for the ordering guard at the top.
insert into public.schema_version (n) values (16) on conflict (n) do nothing;
