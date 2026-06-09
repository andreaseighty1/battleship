alter table public.battleship_scores
add column if not exists mode text not null default 'arcade';

create index if not exists battleship_scores_mode_fastest_idx
on public.battleship_scores (mode asc, duration_ms asc, shots asc, finished_at asc);
