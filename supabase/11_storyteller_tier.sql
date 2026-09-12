-- BOTC Wordle: Fabled and Loric earn the top tier through Endless.
-- Run AFTER 10_cleanup_test_user.sql. Safe to re-run.
--
-- Fabled and Loric are deliberately excluded from both dailies and from Versus,
-- because two of the seven clue columns collapse for them. Endless is therefore
-- the ONLY way to meet one, which under the original rule meant they could
-- never carry the daily ring and a complete collection was unobtainable.
--
-- So the ring does not mean "earned in a daily", it means "earned the best way
-- that character can be earned". For every player character that is still a
-- daily. For a storyteller character it is Endless, because nothing else is on
-- offer. The column keeps its name to avoid a rename across the codebase; this
-- comment is the authority on what it means.

create or replace function public.record_collection(
  p_user uuid, p_character_id text, p_source text default 'daily'
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_storyteller bool;
  v_top bool;
begin
  select (pools ->> 'isStoryteller')::bool into v_storyteller
  from public.characters where id = p_character_id;

  if v_storyteller is null then
    raise exception 'Unknown character: %', p_character_id;
  end if;

  -- Top tier: a daily win, or any win at all for a character the dailies
  -- cannot serve.
  v_top := (p_source = 'daily') or v_storyteller;

  insert into public.user_collection (
    user_id, character_id, earned_daily, earned_endless, earned_pvp
  )
  values (
    p_user, p_character_id,
    v_top, p_source = 'endless', p_source = 'pvp'
  )
  on conflict (user_id, character_id) do update set
    earned_count   = public.user_collection.earned_count + 1,
    earned_daily   = public.user_collection.earned_daily   or v_top,
    earned_endless = public.user_collection.earned_endless or (p_source = 'endless'),
    earned_pvp     = public.user_collection.earned_pvp     or (p_source = 'pvp');
end;
$$;

-- Anyone who already met a Fabled or Loric in Endless earns the ring now,
-- rather than having to go and find them again.
update public.user_collection uc
set earned_daily = true
from public.characters c
where c.id = uc.character_id
  and (c.pools ->> 'isStoryteller')::bool
  and not uc.earned_daily;

-- collected_daily counts change, so the summary needs recomputing.
select public.rebuild_player_stats() as players_recalculated;

-- Confirm: no storyteller character should be left without the top tier.
select count(*) as storytellers_missing_ring
from public.user_collection uc
join public.characters c on c.id = uc.character_id
where (c.pools ->> 'isStoryteller')::bool and not uc.earned_daily;
