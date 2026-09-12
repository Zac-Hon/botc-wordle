-- BOTC Wordle: PvP responsiveness.
-- Run AFTER 08_pvp_sync_rematch.sql. Safe to re-run.
--
-- Two problems, both of them latency rather than correctness:
--
--   1. Every action cost two sequential round trips. The client called an RPC
--      that returned nothing, then called pvp_state to find out what happened.
--      On a home connection that is easily 300ms of dead time per click, and it
--      was most obvious on the small actions: readying up, flipping a toggle.
--
--   2. The other player only found out through postgres_changes, which travels
--      the replication path and is the slowest signal available here.
--
-- This file fixes the first by returning the new state from the action itself.
-- The client fixes the second with a Realtime broadcast, which skips the
-- database entirely and reaches the peer in a few milliseconds.

-- Return type changes from void to jsonb, so these must be dropped first.
drop function if exists public.pvp_set_ready(uuid, bool);
drop function if exists public.pvp_configure(uuid, jsonb, int);
drop function if exists public.pvp_start(uuid);
drop function if exists public.pvp_assign(uuid, text);

create or replace function public.pvp_set_ready(p_match uuid, p_ready bool)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update public.pvp_participants set ready = coalesce(p_ready, false)
  where match_id = p_match and user_id = auth.uid();
  update public.pvp_matches set updated_at = now() where id = p_match;
  return public.pvp_state(p_match);
end;
$$;

create or replace function public.pvp_configure(p_match uuid, p_config jsonb, p_cycles int)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update public.pvp_matches
  set config = coalesce(p_config, config),
      cycles = greatest(1, least(3, coalesce(p_cycles, cycles))),
      updated_at = now()
  where id = p_match and host_id = auth.uid() and status = 'lobby';

  if not found then raise exception 'Only the host can configure a match in the lobby'; end if;
  return public.pvp_state(p_match);
end;
$$;

create or replace function public.pvp_start(p_match uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user  uuid := auth.uid();
  v_match public.pvp_matches;
  v_ready int;
begin
  select * into v_match from public.pvp_matches where id = p_match for update;
  if not found then raise exception 'No such match'; end if;
  if v_match.host_id <> v_user then raise exception 'Only the host can start'; end if;

  if v_match.status = 'lobby' then
    select count(*) into v_ready from public.pvp_participants
    where match_id = p_match and ready;
    if v_ready < 2 then raise exception 'Both players must be ready'; end if;

    update public.pvp_matches
    set status = 'active', current_cycle = 1, current_round = 1, updated_at = now()
    where id = p_match;

    perform public.pvp_open_round(p_match, 1, 1);
  end if;

  return public.pvp_state(p_match);
end;
$$;

create or replace function public.pvp_assign(p_round uuid, p_character_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
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

  return public.pvp_state(v_round.match_id);
end;
$$;

-- pvp_advance is called speculatively by whichever client notices the clock,
-- so it too should hand back the result rather than force another read.
drop function if exists public.pvp_advance_state(uuid);
create or replace function public.pvp_advance_state(p_match uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.pvp_advance(p_match);
  return public.pvp_state(p_match);
end;
$$;

grant execute on function public.pvp_set_ready(uuid, bool)        to authenticated;
grant execute on function public.pvp_configure(uuid, jsonb, int)  to authenticated;
grant execute on function public.pvp_start(uuid)                  to authenticated;
grant execute on function public.pvp_assign(uuid, text)           to authenticated;
grant execute on function public.pvp_advance_state(uuid)          to authenticated;

-- The guess submissions keep their own compact return shape (the clue row),
-- but the caller also wants the scoreboard, so offer both in one trip.
drop function if exists public.pvp_submit_guess_state(uuid, text);
create or replace function public.pvp_submit_guess_state(p_round uuid, p_guess_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_result jsonb;
  v_match  uuid;
begin
  select match_id into v_match from public.pvp_rounds where id = p_round;
  v_result := public.pvp_submit_guess(p_round, p_guess_id);
  return jsonb_build_object('result', v_result, 'state', public.pvp_state(v_match));
end;
$$;

grant execute on function public.pvp_submit_guess_state(uuid, text) to authenticated;
