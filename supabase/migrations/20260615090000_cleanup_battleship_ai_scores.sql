delete from public.battleship_scores
where lower(coalesce(opponent_name, '')) in ('datorn', 'ai', 'computer')
   or lower(coalesce(winner_name, '')) in ('datorn', 'ai', 'computer');

create index if not exists battleship_scores_mode_accuracy_idx
on public.battleship_scores (mode asc, hits desc, shots asc, misses asc, duration_ms asc, finished_at asc);

create index if not exists battleship_scores_mode_misses_idx
on public.battleship_scores (mode asc, misses asc, duration_ms asc, shots asc, finished_at asc);
