-- BOTC Wordle: fix ranked matches freezing at "round 0 of 3".
-- Run AFTER 14_ranked_elo_queue.sql. Safe to re-run.
--
-- try_pair created the match and opened round one, but never moved the match's
-- own current_round off its table default of 0. pvp_state looks up the round at
-- (current_cycle, current_round), found nothing at round 0, and returned a null
-- round, so both clients sat on an empty screen forever.
--
-- The narrow fix would be to set current_round = 1 in try_pair. The real fix is
-- that opening a round and declaring it current are one action, not two that
-- callers must remember to pair up: pvp_start had the same two steps and simply
-- happened to do both. pvp_open_round now owns both, so no future caller can
-- get this wrong again.

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

  -- Point the match at this round whether or not we just created it. Doing this
  -- unconditionally means a re-run repairs a match that drifted out of step
  -- rather than leaving it stuck.
  update public.pvp_matches
  set current_cycle = p_cycle, current_round = p_round, updated_at = now()
  where id = p_match and (current_cycle <> p_cycle or current_round <> p_round);

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

-- try_pair also states the position explicitly, so a match is never created in
-- an impossible state even for the moment before the round opens.
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

  insert into public.pvp_matches
    (join_code, host_id, cycles, ranked, status, config, current_cycle, current_round)
  values (v_code, p_user, 1, true, 'active',
          '{"base3": true, "experimental": true, "travellers": true}'::jsonb, 1, 1)
  returning id into v_match;

  insert into public.pvp_participants (match_id, user_id, ready)
  values (v_match, p_user, true), (v_match, other.user_id, true);

  update public.matchmaking_queue set match_id = v_match
  where user_id in (p_user, other.user_id);

  perform public.pvp_open_round(v_match, 1, 1);

  return v_match;
end;
$$;

grant execute on function public.pvp_open_round(uuid, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Repair matches already stuck
-- ---------------------------------------------------------------------------
-- Any active match pointing at round 0 while a real round exists is one of the
-- frozen ones. Point it at the earliest round it actually has.
update public.pvp_matches m
set current_cycle = r.cycle, current_round = r.round_no, updated_at = now()
from (
  select distinct on (match_id) match_id, cycle, round_no
  from public.pvp_rounds
  order by match_id, cycle, round_no
) r
where r.match_id = m.id
  and m.status = 'active'
  and m.current_round = 0;

-- A ranked match that was stuck long enough for its round to expire is not
-- worth resuming, and leaving it active keeps its players out of the queue.
update public.pvp_matches
set status = 'abandoned', updated_at = now()
where status = 'active'
  and ranked
  and updated_at < now() - interval '1 hour';

-- Clear any queue rows pointing at matches that never got going.
delete from public.matchmaking_queue q
using public.pvp_matches m
where q.match_id = m.id and m.status in ('abandoned', 'finished');

select count(*) as still_stuck
from public.pvp_matches
where status = 'active' and current_round = 0;
