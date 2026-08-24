do $$
begin
  if to_regprocedure('public.battleship_tick_game(text)') is not null then
    revoke execute on function public.battleship_tick_game(text) from public;
    revoke execute on function public.battleship_tick_game(text) from anon;
    revoke execute on function public.battleship_tick_game(text) from authenticated;
    grant execute on function public.battleship_tick_game(text) to service_role;
  end if;

  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public;
    revoke execute on function public.rls_auto_enable() from anon;
    revoke execute on function public.rls_auto_enable() from authenticated;
  end if;
end $$;
