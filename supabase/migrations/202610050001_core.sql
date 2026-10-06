create extension if not exists pgcrypto;

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  latitude double precision,
  longitude double precision,
  source_url text,
  unique(name, address)
);
create table public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null check(length(trim(name)) between 1 and 160),
  category text not null default 'Other',
  comparison_group text not null,
  unique(user_id, name)
);
create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  kind text not null check(kind in ('receipt','shelf')),
  file_path text not null,
  file_name text not null,
  mime_type text not null,
  status text not null default 'queued' check(status in ('queued','processing','review','confirmed','failed')),
  version integer not null default 0,
  store_name text,
  branch_id uuid references public.stores,
  purchase_date date,
  subtotal numeric(12,2),
  tax numeric(12,2),
  receipt_discount numeric(12,2) check(receipt_discount >= 0),
  fees numeric(12,2),
  total numeric(12,2),
  notes text,
  uncertain_fields jsonb not null default '[]',
  acknowledged_difference boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, file_path)
);
create table public.receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  position integer not null,
  original_text text not null,
  item_name text not null,
  item_id uuid references public.items,
  category text not null default 'Other',
  comparison_group text not null,
  quantity numeric(12,4) check(quantity > 0),
  package_size numeric(12,4) check(package_size > 0),
  unit text check(unit in ('g','kg','ml','l','count')),
  discount numeric(12,2) check(discount >= 0),
  line_amount numeric(12,2),
  regular_price numeric(12,4) check(regular_price >= 0),
  sale_price numeric(12,4) check(sale_price >= 0),
  uncertain boolean not null default false,
  unique(receipt_id, position)
);
create table public.item_mappings (
  user_id uuid not null references auth.users on delete cascade,
  store_key text not null,
  original_key text not null,
  item_id uuid not null references public.items on delete cascade,
  primary key(user_id, store_key, original_key)
);
create table public.observations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  item_id uuid not null references public.items,
  receipt_id uuid references public.receipts on delete cascade,
  receipt_line_id uuid unique references public.receipt_lines on delete cascade,
  branch_id uuid references public.stores,
  store_name text not null,
  observed_on date not null,
  price numeric(12,4) not null check(price >= 0),
  package_size numeric(12,4) check(package_size > 0),
  unit text check(unit in ('g','kg','ml','l','count')),
  regular_price numeric(12,4) check(regular_price >= 0),
  sale_price numeric(12,4) check(sale_price >= 0),
  source text not null check(source in ('receipt','shelf','manual')),
  source_url text,
  channel text not null check(channel in ('in-store','online pickup','online delivery','unspecified')),
  conditions text not null default '',
  created_at timestamptz not null default now()
);
create table public.offers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  item_id uuid not null references public.items,
  price numeric(12,4) not null check(price >= 0),
  package_size numeric(12,4) check(package_size > 0),
  unit text check(unit in ('g','kg','ml','l','count')),
  regular_price numeric(12,4) check(regular_price >= 0),
  valid_from date not null,
  valid_to date not null,
  source_url text not null check(source_url ~ '^https?://'),
  channel text not null default 'in-store' check(channel in ('in-store','online pickup','online delivery','unspecified')),
  conditions text not null default '',
  created_at timestamptz not null default now(),
  check(valid_to >= valid_from)
);
create table public.offer_stores (
  offer_id uuid not null references public.offers on delete cascade,
  branch_id uuid not null references public.stores,
  user_id uuid not null references auth.users on delete cascade,
  primary key(offer_id, branch_id)
);
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null unique references public.receipts on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  status text not null default 'queued' check(status in ('queued','processing','completed','failed')),
  attempts integer not null default 0,
  run_after timestamptz not null default now(),
  lease_until timestamptz,
  lease_token uuid,
  receipt_version integer,
  last_error text,
  created_at timestamptz not null default now()
);
create index receipts_owner_date on public.receipts(user_id, purchase_date);
create index observations_owner_item on public.observations(user_id, item_id);
create index jobs_ready on public.jobs(status, run_after, lease_until);

alter table public.stores enable row level security;
create policy stores_read on public.stores for select to authenticated using(true);
do $$ declare t text; begin
  foreach t in array array['items','receipts','receipt_lines','item_mappings','observations','offers','offer_stores','jobs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy own_records on public.%I for select to authenticated using (user_id = (select auth.uid()))', t);
    execute format('revoke insert, update, delete on public.%I from authenticated, anon', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
grant select on public.stores to authenticated;
grant all on public.stores to service_role;

-- Text money at the API boundary avoids binary floating point JSON parsing.
create view public.receipts_read with (security_invoker=true) as
select id,user_id,kind,file_path,file_name,mime_type,status,version,store_name,branch_id,purchase_date,
  subtotal::text, tax::text, receipt_discount::text, fees::text, total::text,
  notes,uncertain_fields,acknowledged_difference,created_at,updated_at from public.receipts;
create view public.lines_read with (security_invoker=true) as
select id,receipt_id,user_id,position,original_text,item_name,item_id,category,comparison_group,
  quantity::text,package_size::text,unit,discount::text,line_amount::text,
  regular_price::text,sale_price::text,uncertain from public.receipt_lines;
create view public.observations_read with (security_invoker=true) as
select id,user_id,item_id,receipt_id,receipt_line_id,branch_id,store_name,observed_on,
  price::text,package_size::text,unit,regular_price::text,sale_price::text,source,source_url,channel,conditions,created_at
from public.observations;
create view public.offers_read with (security_invoker=true) as
select id,user_id,item_id,price::text,package_size::text,unit,regular_price::text,
  valid_from,valid_to,source_url,channel,conditions,created_at from public.offers;
grant select on public.receipts_read,public.lines_read,public.observations_read,public.offers_read to authenticated,service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('receipts','receipts',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf']);
create policy own_receipt_files_read on storage.objects for select to authenticated
using(bucket_id='receipts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy own_receipt_files_insert on storage.objects for insert to authenticated
with check(bucket_id='receipts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy own_receipt_files_delete on storage.objects for delete to authenticated
using(bucket_id='receipts' and (storage.foldername(name))[1] = auth.uid()::text);

create function public.initialize_items() returns void language plpgsql security definer
set search_path=public,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  insert into public.items(user_id,name,category,comparison_group)
  select auth.uid(),v.name,v.category,v.name from (values
    ('Bananas','Produce'),('Apples','Produce'),('Avocados','Produce'),('Carrots','Produce'),
    ('Broccoli','Produce'),('Potatoes','Produce'),('Onions','Produce'),('Tomatoes','Produce'),
    ('Milk 2%','Dairy'),('Plain yogurt','Dairy'),('Cheddar cheese','Dairy'),('Butter','Dairy'),
    ('Large eggs','Eggs'),('Chicken breast','Meat'),('Ground beef','Meat'),('Bread','Bakery'),
    ('Rolled oats','Pantry'),('White rice','Pantry'),('Pasta','Pantry'),('Olive oil','Pantry')
  ) as v(name,category) on conflict(user_id,name) do nothing;
end $$;

create function public.queue_receipt(p_path text,p_name text,p_mime text,p_kind text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare rid uuid; begin
  if auth.uid() is null or split_part(p_path,'/',1) <> auth.uid()::text then raise exception 'File ownership required'; end if;
  if not exists(select 1 from storage.objects where bucket_id='receipts' and name=p_path) then raise exception 'Uploaded file not found'; end if;
  insert into public.receipts(user_id,file_path,file_name,mime_type,kind)
  values(auth.uid(),p_path,p_name,p_mime,p_kind)
  on conflict(user_id,file_path) do update set file_name=receipts.file_name returning id into rid;
  insert into public.jobs(receipt_id,user_id) values(rid,auth.uid()) on conflict(receipt_id) do nothing;
  return rid;
end $$;

create function public.retry_receipt(p_id uuid) returns void language plpgsql security definer
set search_path=public,pg_temp as $$
begin
  update public.receipts set status='queued',version=version+1,updated_at=now()
  where id=p_id and user_id=auth.uid() and status='failed';
  if not found then raise exception 'Failed receipt not found'; end if;
  update public.jobs set status='queued',attempts=0,run_after=now(),lease_until=null,lease_token=null,last_error=null
  where receipt_id=p_id and user_id=auth.uid();
end $$;

create function public.claim_job(p_lease_seconds integer default 120) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.jobs; r public.receipts; begin
  with exhausted as (
    update public.jobs set status='failed',last_error='Processing stopped after three attempts. Please retry.'
    where status='processing' and lease_until<now() and attempts>=3 returning receipt_id
  ) update public.receipts set status='failed',updated_at=now() where id in(select receipt_id from exhausted);
  select * into j from public.jobs where attempts<3 and
    ((status='queued' and run_after<=now()) or (status='processing' and lease_until<now()))
    order by created_at for update skip locked limit 1;
  if not found then return null; end if;
  select * into r from public.receipts where id=j.receipt_id for update;
  if r.status not in ('queued','processing') then
    update public.jobs set status='completed' where id=j.id; return null;
  end if;
  update public.jobs set status='processing',attempts=attempts+1,receipt_version=r.version,
    lease_until=now()+make_interval(secs=>greatest(2,p_lease_seconds)),lease_token=gen_random_uuid()
    where id=j.id returning * into j;
  update public.receipts set status='processing',updated_at=now() where id=r.id;
  return jsonb_build_object('job',to_jsonb(j),'receipt',to_jsonb(r));
end $$;
create function public.renew_job(p_id uuid,p_token uuid,p_lease_seconds integer) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.jobs set lease_until=now()+make_interval(secs=>greatest(2,p_lease_seconds))
  where id=p_id and lease_token=p_token and status='processing' and lease_until>now();
  return found;
end $$;
create function public.fail_job(p_id uuid,p_token uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.jobs; begin
  select * into j from public.jobs where id=p_id and lease_token=p_token and status='processing' for update;
  if not found then return; end if;
  update public.jobs set status=case when attempts>=3 then 'failed' else 'queued' end,
    last_error='The extraction service could not process this file. Please retry.',
    run_after=now()+make_interval(secs=>least(30,attempts*2)),lease_until=null,lease_token=null where id=p_id;
  update public.receipts set status=case when j.attempts>=3 then 'failed' else 'queued' end,updated_at=now()
  where id=j.receipt_id and version=j.receipt_version and status='processing';
end $$;

-- Called by the worker and by the guarded review RPC. No direct client access.
create function public.replace_lines(p_id uuid,p_user uuid,p_lines jsonb) returns void
language plpgsql set search_path=public,pg_temp as $$
declare l jsonb; pos integer:=0; begin
  delete from public.receipt_lines where receipt_id=p_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    insert into public.receipt_lines(id,receipt_id,user_id,position,original_text,item_name,category,comparison_group,
      quantity,package_size,unit,discount,line_amount,regular_price,sale_price,uncertain)
    values(coalesce(nullif(l->>'id','')::uuid,gen_random_uuid()),p_id,p_user,pos,
      coalesce(l->>'original_text',''),coalesce(l->>'item_name',''),coalesce(l->>'category','Other'),
      coalesce(nullif(l->>'comparison_group',''),l->>'item_name',''),
      nullif(l->>'quantity','')::numeric,nullif(l->>'package_size','')::numeric,nullif(l->>'unit',''),
      nullif(l->>'discount','')::numeric,nullif(l->>'line_amount','')::numeric,
      nullif(l->>'regular_price','')::numeric,nullif(l->>'sale_price','')::numeric,
      coalesce((l->>'uncertain')::boolean,false));
    pos:=pos+1;
  end loop;
end $$;
create function public.complete_job(p_id uuid,p_token uuid,p_draft jsonb) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.jobs; begin
  select * into j from public.jobs where id=p_id and lease_token=p_token and status='processing' and lease_until>now() for update;
  if not found then return false; end if;
  update public.receipts set status='review',store_name=nullif(p_draft->>'store_name',''),
    purchase_date=nullif(p_draft->>'purchase_date','')::date,
    subtotal=nullif(p_draft->>'subtotal','')::numeric,tax=nullif(p_draft->>'tax','')::numeric,
    receipt_discount=nullif(p_draft->>'receipt_discount','')::numeric,fees=nullif(p_draft->>'fees','')::numeric,
    total=nullif(p_draft->>'total','')::numeric,uncertain_fields=coalesce(p_draft->'uncertain_fields','[]'),
    notes=p_draft->>'notes',version=version+1,updated_at=now()
    where id=j.receipt_id and version=j.receipt_version and status='processing';
  if not found then update public.jobs set status='completed' where id=j.id; return false; end if;
  perform public.replace_lines(j.receipt_id,j.user_id,p_draft->'lines');
  update public.jobs set status='completed',last_error=null,lease_until=null where id=j.id;
  return true;
end $$;

create function public.save_receipt(p_id uuid,p_version integer,p_draft jsonb,p_confirm boolean)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.receipts; l public.receipt_lines; iid uuid; line_sum numeric; changed_total numeric; mismatch boolean; begin
  select * into r from public.receipts where id=p_id and user_id=auth.uid() for update;
  if not found then raise exception 'Receipt not found'; end if;
  if r.version<>p_version then raise exception 'This receipt changed. Reload it before saving.'; end if;
  if r.status not in ('review','confirmed') then raise exception 'Receipt is not ready for review'; end if;
  -- A confirmed receipt remains confirmed while being corrected.
  p_confirm := p_confirm or r.status='confirmed';
  if p_confirm and (nullif(trim(p_draft->>'store_name'),'') is null or nullif(p_draft->>'purchase_date','') is null) then
    raise exception 'Store and date are required'; end if;
  if p_confirm and jsonb_array_length(p_draft->'lines')=0 then raise exception 'At least one item is required'; end if;
  if p_confirm and r.kind='receipt' and nullif(p_draft->>'total','') is null then raise exception 'Receipt total is required'; end if;
  perform public.replace_lines(r.id,r.user_id,p_draft->'lines');
  update public.receipts set store_name=coalesce(
    (select name from public.stores where id=nullif(p_draft->>'branch_id','')::uuid),
    nullif(trim(p_draft->>'store_name'),'')),
    branch_id=nullif(p_draft->>'branch_id','')::uuid,purchase_date=nullif(p_draft->>'purchase_date','')::date,
    subtotal=nullif(p_draft->>'subtotal','')::numeric,tax=nullif(p_draft->>'tax','')::numeric,
    receipt_discount=nullif(p_draft->>'receipt_discount','')::numeric,fees=nullif(p_draft->>'fees','')::numeric,
    total=nullif(p_draft->>'total','')::numeric,notes=p_draft->>'notes',
    acknowledged_difference=coalesce((p_draft->>'acknowledged_difference')::boolean,false),
    status=case when p_confirm then 'confirmed' else 'review' end,
    uncertain_fields=case when p_confirm then '[]'::jsonb else uncertain_fields end,
    version=version+1,updated_at=now() where id=r.id returning * into r;
  select sum(line_amount) into line_sum from public.receipt_lines where receipt_id=r.id;
  mismatch := r.subtotal is null or r.tax is null or line_sum is null or
    exists(select 1 from public.receipt_lines where receipt_id=r.id and line_amount is null) or
    line_sum<>r.subtotal or
    (r.subtotal+r.tax-coalesce(r.receipt_discount,0)+coalesce(r.fees,0))<>r.total;
  if p_confirm and r.kind='receipt' and mismatch and not r.acknowledged_difference then
    raise exception 'Resolve or acknowledge the unexplained difference'; end if;
  if p_confirm then
    for l in select * from public.receipt_lines where receipt_id=r.id order by position loop
      if trim(l.item_name)='' or trim(l.comparison_group)='' then raise exception 'Item name and comparison group are required'; end if;
      insert into public.items(user_id,name,category,comparison_group)
      values(r.user_id,l.item_name,l.category,l.comparison_group)
      on conflict(user_id,name) do update set category=excluded.category,comparison_group=excluded.comparison_group returning id into iid;
      update public.receipt_lines set item_id=iid,uncertain=false where id=l.id;
      insert into public.item_mappings(user_id,store_key,original_key,item_id)
      values(r.user_id,lower(trim(r.store_name)),lower(trim(l.original_text)),iid)
      on conflict(user_id,store_key,original_key) do update set item_id=excluded.item_id;
      if l.quantity is not null and l.line_amount is not null and l.line_amount>=0 then
        insert into public.observations(user_id,item_id,receipt_id,receipt_line_id,branch_id,store_name,
          observed_on,price,package_size,unit,regular_price,sale_price,source,channel)
        values(r.user_id,iid,r.id,l.id,r.branch_id,r.store_name,r.purchase_date,round(l.line_amount/l.quantity,4),
          l.package_size,l.unit,l.regular_price,l.sale_price,r.kind,'in-store');
      end if;
    end loop;
  end if;
end $$;

create function public.add_observation(p_data jsonb) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare oid uuid; branch public.stores; begin
  if not exists(select 1 from public.items where id=(p_data->>'item_id')::uuid and user_id=auth.uid()) then raise exception 'Item not found'; end if;
  select * into branch from public.stores where id=nullif(p_data->>'branch_id','')::uuid;
  if nullif(trim(coalesce(branch.name,p_data->>'store_name')),'') is null then raise exception 'Store is required'; end if;
  insert into public.observations(user_id,item_id,branch_id,store_name,observed_on,price,package_size,unit,
    regular_price,sale_price,source,source_url,channel,conditions)
  values(auth.uid(),(p_data->>'item_id')::uuid,branch.id,coalesce(branch.name,p_data->>'store_name'),
    (p_data->>'observed_on')::date,(p_data->>'price')::numeric,nullif(p_data->>'package_size','')::numeric,
    nullif(p_data->>'unit',''),nullif(p_data->>'regular_price','')::numeric,nullif(p_data->>'sale_price','')::numeric,
    'manual',nullif(p_data->>'source_url',''),p_data->>'channel',coalesce(p_data->>'conditions','')) returning id into oid;
  return oid;
end $$;
create function public.import_offers(p_rows jsonb) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare row jsonb; oid uuid; branch text; count integer:=0; begin
  if jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'Import 1 to 500 offers'; end if;
  for row in select * from jsonb_array_elements(p_rows) loop
    if not exists(select 1 from public.items where id=(row->>'item_id')::uuid and user_id=auth.uid()) then raise exception 'Item not found'; end if;
    if jsonb_array_length(row->'branch_ids')=0 then raise exception 'Choose at least one applicable branch'; end if;
    insert into public.offers(user_id,item_id,price,package_size,unit,regular_price,valid_from,valid_to,source_url,channel,conditions)
    values(auth.uid(),(row->>'item_id')::uuid,(row->>'price')::numeric,nullif(row->>'package_size','')::numeric,
      nullif(row->>'unit',''),nullif(row->>'regular_price','')::numeric,(row->>'valid_from')::date,(row->>'valid_to')::date,
      row->>'source_url',coalesce(row->>'channel','in-store'),coalesce(row->>'conditions','')) returning id into oid;
    for branch in select jsonb_array_elements_text(row->'branch_ids') loop
      insert into public.offer_stores(offer_id,branch_id,user_id) values(oid,branch::uuid,auth.uid());
    end loop;
    count:=count+1;
  end loop;
  return count;
end $$;

-- All definer functions are closed by default; only intended callers can execute.
revoke execute on function public.initialize_items(),public.queue_receipt(text,text,text,text),
  public.retry_receipt(uuid),public.save_receipt(uuid,integer,jsonb,boolean),public.add_observation(jsonb),
  public.import_offers(jsonb),public.replace_lines(uuid,uuid,jsonb),public.claim_job(integer),
  public.renew_job(uuid,uuid,integer),public.fail_job(uuid,uuid),public.complete_job(uuid,uuid,jsonb)
  from public,anon,authenticated;
grant execute on function public.initialize_items(),public.queue_receipt(text,text,text,text),
  public.retry_receipt(uuid),public.save_receipt(uuid,integer,jsonb,boolean),public.add_observation(jsonb),
  public.import_offers(jsonb) to authenticated;
grant execute on function public.claim_job(integer),public.renew_job(uuid,uuid,integer),
  public.fail_job(uuid,uuid),public.complete_job(uuid,uuid,jsonb) to service_role;
