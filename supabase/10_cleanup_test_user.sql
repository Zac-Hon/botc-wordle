-- BOTC Wordle: remove the throwaway account used to verify the backend.
-- Run this once, in the Supabase SQL Editor. It is safe to re-run: after the
-- first run it simply finds nothing and reports 0.
--
-- Everything hangs off auth.users with ON DELETE CASCADE, so deleting the user
-- takes their profile, sessions, collection, PvP participation and results with
-- it. The explicit deletes below are belt and braces, and they also clean up
-- anything a cascade would not reach, such as a match this user hosted.

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
  if v_max is not null and v_max > 10 then
    raise exception 'Refusing to run 10_cleanup_test_user.sql: migration % is already applied. Apply the numbered files in order, or not at all.', v_max;
  end if;
end
$guard$;


do $$
declare
  v_user uuid;
  v_name text := 'zz-claude-test';
begin
  select id into v_user from public.profiles where lower(username) = v_name;

  if v_user is null then
    -- Fall back to the synthesised address in case the profile row is gone.
    select id into v_user from auth.users
    where email = v_name || '@botc-wordle.local';
  end if;

  if v_user is null then
    raise notice 'No % account found, nothing to remove.', v_name;
    return;
  end if;

  raise notice 'Removing % (%)', v_name, v_user;

  -- Matches this account hosted would otherwise linger with one participant.
  delete from public.pvp_matches
  where host_id = v_user
     or id in (select match_id from public.pvp_participants where user_id = v_user);

  delete from public.pvp_round_results  where user_id = v_user;
  delete from public.pvp_round_answers  where user_id = v_user;
  delete from public.pvp_participants   where user_id = v_user;
  delete from public.endless_sessions   where user_id = v_user;
  delete from public.user_collection    where user_id = v_user;
  delete from public.game_sessions      where user_id = v_user;
  delete from public.player_stats       where user_id = v_user;
  delete from public.profiles           where id = v_user;

  -- Removing the auth row cascades over anything missed above.
  delete from auth.users where id = v_user;

  raise notice 'Done.';
end
$$;

-- Confirm. Both counts must be 0.
select
  (select count(*) from auth.users where email like 'zz-claude-test@%')      as auth_rows,
  (select count(*) from public.profiles where lower(username) = 'zz-claude-test') as profile_rows;

-- The summary table may hold a stale row for the deleted player; rebuild it.
select public.rebuild_player_stats() as players_recalculated;

-- Records this file as applied, for the ordering guard at the top.
insert into public.schema_version (n) values (10) on conflict (n) do nothing;
