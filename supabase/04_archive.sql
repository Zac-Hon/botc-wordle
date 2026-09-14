-- BOTC Wordle -- archive listing. Run AFTER 03_policies.sql.
-- Safe to re-run.

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
  if v_max is not null and v_max > 4 then
    raise exception 'Refusing to run 04_archive.sql: migration % is already applied. Apply the numbered files in order, or not at all.', v_max;
  end if;
end
$guard$;


-- Lists past puzzles together with how the caller did on each.
--
-- It returns dates and the caller's own results only -- never a character_id --
-- so it cannot be used to read ahead. The `puzzle_date <= today` filter is what
-- keeps tomorrow out; daily_puzzles itself stays unreadable to clients.
--
-- A date can have TWO sessions: the original same-day play (is_archive = false)
-- and a later replay from the archive (is_archive = true). The lateral join
-- picks the original in preference, so replaying a puzzle never overwrites the
-- record of how you did on the day.
create or replace function public.archive_list(
  p_mode   text default null,
  p_limit  int  default 60,
  p_before date default null
)
returns table (
  puzzle_date date,
  mode        text,
  played      bool,
  solved      bool,
  gave_up     bool,
  guess_count int,
  is_archive  bool
)
language sql
security definer set search_path = public
stable
as $$
  select
    d.puzzle_date,
    d.mode,
    (s.id is not null)              as played,
    coalesce(s.solved, false)       as solved,
    coalesce(s.gave_up, false)      as gave_up,
    coalesce(s.guess_count, 0)      as guess_count,
    coalesce(s.is_archive, false)   as is_archive
  from public.daily_puzzles d
  left join lateral (
    select g.*
    from public.game_sessions g
    where g.user_id = auth.uid()
      and g.mode = d.mode
      and g.puzzle_date = d.puzzle_date
    order by g.is_archive asc, g.solved desc, g.guess_count asc
    limit 1
  ) s on true
  where d.puzzle_date <= (now() at time zone 'utc')::date
    and (p_mode is null or d.mode = p_mode)
    and (p_before is null or d.puzzle_date < p_before)
  order by d.puzzle_date desc, d.mode asc
  limit least(coalesce(p_limit, 60), 200);
$$;

grant execute on function public.archive_list(text, int, date) to authenticated;

-- Records this file as applied, for the ordering guard at the top.
insert into public.schema_version (n) values (4) on conflict (n) do nothing;
