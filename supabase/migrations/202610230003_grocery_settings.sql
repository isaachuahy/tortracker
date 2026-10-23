create table public.grocery_settings (
  user_id uuid primary key references auth.users on delete cascade,
  postal_code text not null check(postal_code ~ '^[ABCEGHJ-NPRSTVXY][0-9][ABCEGHJ-NPRSTVWXYZ][0-9][ABCEGHJ-NPRSTVWXYZ][0-9]$'),
  updated_at timestamptz not null default now()
);
alter table public.grocery_settings enable row level security;
create policy grocery_settings_owner on public.grocery_settings for select to authenticated
  using(user_id = (select auth.uid()));
revoke all on public.grocery_settings from anon, authenticated;
grant select on public.grocery_settings to authenticated;
grant all on public.grocery_settings to service_role;

create function public.save_grocery_settings(p_postal_code text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  insert into public.grocery_settings(user_id,postal_code)
  values(auth.uid(),upper(replace(trim(p_postal_code),' ','')))
  on conflict(user_id) do update set postal_code=excluded.postal_code,updated_at=now();
end $$;
revoke execute on function public.save_grocery_settings(text) from public,anon;
grant execute on function public.save_grocery_settings(text) to authenticated;
