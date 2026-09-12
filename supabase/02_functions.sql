-- BOTC Wordle -- comparator and RPCs. Run AFTER 01_schema.sql.

-- ---------------------------------------------------------------------------
-- The clue comparator
-- ---------------------------------------------------------------------------
-- This is the SQL mirror of src/game/compare.ts. Both are generic engines
-- driven by the same clue_spec rows, so a column change is a re-seed rather
-- than a code change on either side -- but the two implementations must still
-- agree exactly. scripts/verify-parity.ts checks that over thousands of random
-- pairs and is the reason botc_compare is exposed rather than kept private.
--
-- Exposing it leaks nothing: the caller supplies BOTH sides, so it only ever
-- tells you about two characters you already named. The daily RPC below calls
-- this same function with the hidden answer, so testing it genuinely tests the
-- code path the dailies use.
create or replace function public.botc_compare(p_guess jsonb, p_answer jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  col        record;
  g          jsonb;
  a          jsonb;
  verdict    text;
  direction  text;
  cell       jsonb;
  cells      jsonb := '[]'::jsonb;
  gnum       numeric;
  anum       numeric;
  tol        numeric;
  shared     int;
  gcount     int;
  acount     int;
  g_group    text;
  a_group    text;
begin
  for col in select * from public.clue_spec order by ordinal loop
    g := p_guess -> col.key;
    a := p_answer -> col.key;
    direction := null;
    verdict := 'miss';

    if col.kind = 'exact' then
      verdict := case when g = a then 'match' else 'miss' end;

    elsif col.kind = 'group' then
      if g = a then
        verdict := 'match';
      else
        g_group := col.params -> 'groups' ->> (g #>> '{}');
        a_group := col.params -> 'groups' ->> (a #>> '{}');
        verdict := case
          when g_group is not null and g_group = a_group then 'partial'
          else 'miss'
        end;
      end if;

    elsif col.kind = 'numeric' then
      if g is null or a is null or g = 'null'::jsonb or a = 'null'::jsonb then
        -- Two characters who both never wake share a genuine trait; one of each
        -- gives no ordering, so there is no arrow either way.
        verdict := case
          when coalesce(col.params ->> 'nullable', 'false')::boolean
               and (g is null or g = 'null'::jsonb)
               and (a is null or a = 'null'::jsonb)
          then 'match'
          else 'miss'
        end;
      else
        gnum := (g #>> '{}')::numeric;
        anum := (a #>> '{}')::numeric;
        if gnum = anum then
          verdict := 'match';
        else
          direction := case when anum > gnum then 'up' else 'down' end;
          tol := coalesce((col.params ->> 'tolerance')::numeric, 0);
          verdict := case when abs(gnum - anum) <= tol then 'partial' else 'miss' end;
        end if;
      end if;

    elsif col.kind = 'set' then
      gcount := coalesce(jsonb_array_length(g), 0);
      acount := coalesce(jsonb_array_length(a), 0);
      select count(*) into shared
      from jsonb_array_elements_text(coalesce(g, '[]'::jsonb)) t
      where t.value in (select value from jsonb_array_elements_text(coalesce(a, '[]'::jsonb)));

      verdict := case
        when shared = gcount and gcount = acount then 'match'
        when shared > 0 then 'partial'
        else 'miss'
      end;
    end if;

    cell := jsonb_build_object(
      'key', col.key,
      'label', col.label,
      'shortLabel', col.short_label,
      'result', verdict,
      'value', coalesce(g, 'null'::jsonb)
    );
    -- Omitted rather than null when absent, to match the TypeScript shape.
    if direction is not null then
      cell := cell || jsonb_build_object('direction', direction);
    end if;

    cells := cells || jsonb_build_array(cell);
  end loop;

  return cells;
end;
$$;

grant execute on function public.botc_compare(jsonb, jsonb) to anon, authenticated;

-- Convenience wrapper so the parity test can check many pairs in one round trip.
create or replace function public.botc_compare_batch(p_pairs jsonb)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(public.botc_compare(pair -> 'guess', pair -> 'answer') order by ord), '[]'::jsonb)
  from jsonb_array_elements(p_pairs) with ordinality as t(pair, ord);
$$;

grant execute on function public.botc_compare_batch(jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Daily play
-- ---------------------------------------------------------------------------

-- Starts (or resumes) today's daily. Returns the session without the answer.
create or replace function public.start_daily(p_mode text, p_date date default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_user    uuid := auth.uid();
  v_date    date := coalesce(p_date, (now() at time zone 'utc')::date);
  v_today   date := (now() at time zone 'utc')::date;
  v_archive bool := v_date < v_today;
  v_session public.game_sessions;
  v_answer_name text;
  v_wrong int;
begin
  if v_user is null then
    raise exception 'Not signed in';
  end if;
  if p_mode not in ('classic', 'full') then
    raise exception 'Unknown daily mode: %', p_mode;
  end if;
  -- The one rule that matters: no playing a puzzle that has not happened yet.
  if v_date > v_today then
    raise exception 'That puzzle is not available yet';
  end if;
  if not exists (select 1 from public.daily_puzzles where puzzle_date = v_date and mode = p_mode) then
    raise exception 'No puzzle seeded for % (%)', v_date, p_mode;
  end if;

  select * into v_session
  from public.game_sessions
  where user_id = v_user and mode = p_mode and puzzle_date = v_date and is_archive = v_archive
  limit 1;

  if not found then
    insert into public.game_sessions (user_id, mode, puzzle_date, is_archive)
    values (v_user, p_mode, v_date, v_archive)
    returning * into v_session;
  end if;

  -- Resuming has to re-issue whatever the player already earned, or reloading
  -- the page silently takes their hangman away. Same disclosure rule as
  -- submit_daily_guess: the NAME at HANGMAN_START wrong guesses, the IDENTITY
  -- only once the game is over.
  select c.name into v_answer_name
  from public.daily_puzzles d
  join public.characters c on c.id = d.character_id
  where d.puzzle_date = v_session.puzzle_date and d.mode = v_session.mode;

  v_wrong := v_session.guess_count - (case when v_session.solved then 1 else 0 end);

  return jsonb_build_object(
    'sessionId', v_session.id,
    'mode', v_session.mode,
    'puzzleDate', v_session.puzzle_date,
    'guesses', v_session.guesses,
    'guessCount', v_session.guess_count,
    'wrongCount', v_wrong,
    'solved', v_session.solved,
    'gaveUp', v_session.gave_up,
    'isArchive', v_session.is_archive,
    'answerName', case
      when v_session.solved or v_session.gave_up or v_wrong >= 4 then v_answer_name
      else null
    end,
    -- Only ever populated once the game is over.
    'answerId', case when v_session.solved or v_session.gave_up then v_session.character_id else null end
  );
end;
$$;

grant execute on function public.start_daily(text, date) to authenticated;

-- Submits one guess. The answer is revealed only on a solve.
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

  if not found then
    raise exception 'No such session';
  end if;
  if v_session.solved or v_session.gave_up then
    raise exception 'That game is already finished';
  end if;

  select * into v_guess from public.characters where id = p_guess_id;
  if not found then
    raise exception 'Unknown character: %', p_guess_id;
  end if;

  select character_id into v_answer from public.daily_puzzles
  where puzzle_date = v_session.puzzle_date and mode = v_session.mode;

  select * into v_ans from public.characters where id = v_answer;

  v_clue := public.botc_compare(v_guess.attrs, v_ans.attrs);
  v_solved := (v_guess.id = v_ans.id);

  v_entry := jsonb_build_object('id', v_guess.id, 'name', v_guess.name, 'clue', v_clue);

  update public.game_sessions
  set guesses     = guesses || jsonb_build_array(v_entry),
      guess_count = guess_count + 1,
      solved      = v_solved,
      character_id = case when v_solved then v_ans.id else character_id end,
      finished_at = case when v_solved then now() else finished_at end
  where id = v_session.id
  returning * into v_session;

  return jsonb_build_object(
    'clue', v_clue,
    'guessId', v_guess.id,
    'guessName', v_guess.name,
    'solved', v_solved,
    'guessCount', v_session.guess_count,
    'wrongCount', v_session.guess_count - (case when v_solved then 1 else 0 end),
    -- The name is needed for the hangman display, so it is sent only once the
    -- player has earned it: at HANGMAN_START wrong guesses. The client renders
    -- the blanks; it never receives the answer before then.
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

-- Gives up: reveals the answer and closes the session as a loss.
create or replace function public.give_up(p_session_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_user    uuid := auth.uid();
  v_session public.game_sessions;
  v_answer  public.characters;
begin
  if v_user is null then
    raise exception 'Not signed in';
  end if;

  select * into v_session from public.game_sessions
  where id = p_session_id and user_id = v_user for update;
  if not found then
    raise exception 'No such session';
  end if;

  select c.* into v_answer
  from public.daily_puzzles d
  join public.characters c on c.id = d.character_id
  where d.puzzle_date = v_session.puzzle_date and d.mode = v_session.mode;

  update public.game_sessions
  set gave_up = true, character_id = v_answer.id, finished_at = now()
  where id = v_session.id;

  return jsonb_build_object('answerId', v_answer.id, 'answerName', v_answer.name);
end;
$$;

grant execute on function public.give_up(uuid) to authenticated;
