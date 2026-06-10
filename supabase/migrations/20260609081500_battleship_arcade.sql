create table if not exists public.battleship_games (
  code text primary key,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz
);

create table if not exists public.battleship_game_ticks (
  code text primary key,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists public.battleship_scores (
  id bigserial primary key,
  code text not null,
  mode text not null default 'arcade',
  winner_name text not null,
  opponent_name text,
  duration_ms integer not null,
  shots integer not null,
  hits integer not null default 0,
  misses integer not null default 0,
  finished_at timestamptz not null default now()
);

alter table public.battleship_scores
add column if not exists hits integer not null default 0;

alter table public.battleship_scores
add column if not exists misses integer not null default 0;

alter table public.battleship_scores
add column if not exists mode text not null default 'arcade';

alter table public.battleship_games
add column if not exists expires_at timestamptz;

create index if not exists battleship_games_expires_at_idx
on public.battleship_games (expires_at asc);

create index if not exists battleship_scores_fastest_idx
on public.battleship_scores (duration_ms asc, shots asc, finished_at asc);

create index if not exists battleship_scores_mode_fastest_idx
on public.battleship_scores (mode asc, duration_ms asc, shots asc, finished_at asc);

alter table public.battleship_games enable row level security;
alter table public.battleship_game_ticks enable row level security;
alter table public.battleship_scores enable row level security;

drop policy if exists "Public can watch game ticks" on public.battleship_game_ticks;
create policy "Public can watch game ticks"
on public.battleship_game_ticks
for select
to anon, authenticated
using (true);

drop policy if exists "Public can read score list" on public.battleship_scores;
create policy "Public can read score list"
on public.battleship_scores
for select
to anon, authenticated
using (true);

create or replace function public.battleship_tick_game(game_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.battleship_game_ticks (code, version, updated_at)
  values (game_code, 1, now())
  on conflict (code) do update
    set version = public.battleship_game_ticks.version + 1,
        updated_at = now();
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.battleship_game_ticks;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
