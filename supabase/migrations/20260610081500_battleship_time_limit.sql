alter table public.battleship_games
add column if not exists expires_at timestamptz;

create index if not exists battleship_games_expires_at_idx
on public.battleship_games (expires_at asc);
