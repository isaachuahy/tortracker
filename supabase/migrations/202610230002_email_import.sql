-- Gmail credentials stay in the import worker's environment. These tables store
-- only owner-readable provenance and sync progress, never OAuth tokens.
create table public.email_import_sources (
  user_id uuid not null references auth.users on delete cascade,
  provider text not null default 'gmail' check(provider = 'gmail'),
  account_key text not null check(account_key ~ '^[0-9a-f]{64}$'),
  status text not null check(status in ('running','ready','partial','error')),
  query_hash text not null,
  next_page_token text,
  last_attempt_at timestamptz not null default now(),
  last_success_at timestamptz,
  imported_count integer not null default 0 check(imported_count >= 0),
  scanned_count integer not null default 0 check(scanned_count >= 0),
  last_error text,
  primary key(user_id,provider,account_key)
);

create table public.email_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  provider text not null default 'gmail' check(provider = 'gmail'),
  account_key text not null check(account_key ~ '^[0-9a-f]{64}$'),
  message_id text not null check(length(message_id) between 1 and 200),
  part_key text not null check(length(part_key) between 1 and 200),
  receipt_id uuid not null references public.receipts on delete cascade,
  source_url text not null,
  imported_at timestamptz not null default now(),
  unique(user_id,provider,account_key,message_id,part_key)
);
create index email_imports_owner_date on public.email_imports(user_id,imported_at desc);

alter table public.email_import_sources enable row level security;
alter table public.email_imports enable row level security;
create policy email_source_owner_read on public.email_import_sources
  for select to authenticated using(user_id=(select auth.uid()));
create policy email_import_owner_read on public.email_imports
  for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.email_import_sources,public.email_imports from anon,authenticated;
grant select on public.email_import_sources,public.email_imports to authenticated;
grant all on public.email_import_sources,public.email_imports to service_role;

-- Plain text is private evidence, processed by the same durable receipt queue.
update storage.buckets set allowed_mime_types = array[
  'image/jpeg','image/png','image/webp','application/pdf','text/plain'
] where id='receipts';

create function public.queue_email_receipt(
  p_user_id uuid,p_account_key text,p_message_id text,p_part_key text,
  p_path text,p_name text,p_mime text
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare rid uuid; begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'Service access required';
  end if;
  if p_account_key !~ '^[0-9a-f]{64}$' or
    length(p_message_id) not between 1 and 200 or p_message_id !~ '^[a-zA-Z0-9_-]+$' or
    length(p_part_key) not between 1 and 200 then
    raise exception 'Invalid email source identity';
  end if;
  if split_part(p_path,'/',1) <> p_user_id::text or
    not exists(select 1 from storage.objects where bucket_id='receipts' and name=p_path) then
    raise exception 'Uploaded owner evidence required';
  end if;
  if p_mime not in ('text/plain','application/pdf','image/jpeg','image/png','image/webp') then
    raise exception 'Unsupported email evidence';
  end if;
  -- Serialize duplicate imports, including separate worker instances. A crash
  -- after upload is safe: retries use the same immutable object path and key.
  perform pg_advisory_xact_lock(hashtextextended(
    p_user_id::text||':'||p_account_key||':'||p_message_id||':'||p_part_key,0));
  select receipt_id into rid from public.email_imports where user_id=p_user_id
    and provider='gmail' and account_key=p_account_key and message_id=p_message_id and part_key=p_part_key;
  if found then return rid; end if;
  insert into public.receipts(user_id,kind,file_path,file_name,mime_type)
    values(p_user_id,'receipt',p_path,left(p_name,250),p_mime) returning id into rid;
  insert into public.jobs(receipt_id,user_id) values(rid,p_user_id);
  insert into public.email_imports(user_id,account_key,message_id,part_key,receipt_id,source_url)
    values(p_user_id,p_account_key,p_message_id,p_part_key,rid,
      'https://mail.google.com/mail/u/0/#all/'||p_message_id);
  return rid;
end $$;
revoke execute on function public.queue_email_receipt(uuid,text,text,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.queue_email_receipt(uuid,text,text,text,text,text,text) to service_role;
