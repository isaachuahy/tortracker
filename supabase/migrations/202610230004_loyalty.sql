-- PC Optimum rewards and account activity are independent of cash prices and spending.
create table public.loyalty_offers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  source_id text not null check(length(trim(source_id)) between 1 and 250),
  title text not null check(length(trim(title)) between 1 and 250),
  scope text not null check(scope in ('item','category','basket','unknown')),
  item_id uuid references public.items on delete set null,
  points integer check(points >= 0),
  points_multiplier numeric(10,4) check(points_multiplier > 0 and points_multiplier <> 'NaN'::numeric),
  minimum_spend numeric(10,2) check(minimum_spend >= 0 and minimum_spend <> 'NaN'::numeric),
  minimum_quantity integer check(minimum_quantity > 0),
  starts_at timestamptz,
  ends_at timestamptz,
  valid_from date,
  valid_to date,
  terms text not null check(length(trim(terms)) between 1 and 4000),
  source_url text not null check(source_url ~ '^https://' and length(source_url) <= 2048),
  activation_state text not null default 'unknown' check(activation_state in ('active','available','unknown')),
  observed_at timestamptz not null check(isfinite(observed_at)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,source_id),
  check((starts_at is null or isfinite(starts_at)) and (ends_at is null or isfinite(ends_at)) and
    (starts_at is null or ends_at is null or ends_at > starts_at)),
  check((valid_from is null or isfinite(valid_from)) and (valid_to is null or isfinite(valid_to)) and
    (valid_from is null or valid_to is null or valid_to >= valid_from))
);

create table public.loyalty_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  source_id text not null check(length(trim(source_id)) between 1 and 250),
  occurred_at timestamptz check(isfinite(occurred_at)),
  observed_at timestamptz not null check(isfinite(observed_at)),
  points_delta integer not null,
  type text not null check(type in ('earned','redeemed','adjustment','unknown')),
  merchant text check(length(trim(merchant)) between 1 and 160),
  receipt_id uuid references public.receipts on delete set null,
  source_url text not null check(source_url ~ '^https://' and length(source_url) <= 2048),
  description text not null check(length(description) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,source_id),
  check((type <> 'earned' or points_delta >= 0) and (type <> 'redeemed' or points_delta <= 0))
);

create index loyalty_offers_owner_observed on public.loyalty_offers(user_id,observed_at desc);
create index loyalty_transactions_owner_observed on public.loyalty_transactions(user_id,observed_at desc);
alter table public.loyalty_offers enable row level security;
alter table public.loyalty_transactions enable row level security;
create policy loyalty_offers_owner_read on public.loyalty_offers
  for select to authenticated using(user_id=(select auth.uid()));
create policy loyalty_transactions_owner_read on public.loyalty_transactions
  for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.loyalty_offers,public.loyalty_transactions from public,anon,authenticated;
grant select on public.loyalty_offers,public.loyalty_transactions to authenticated;
grant all on public.loyalty_offers,public.loyalty_transactions to service_role;

create view public.loyalty_offers_read with (security_invoker=true) as
select id,user_id,source_id,title,scope,item_id,points,points_multiplier::text,minimum_spend::text,
  minimum_quantity,starts_at,ends_at,valid_from,valid_to,terms,source_url,activation_state,
  observed_at,created_at,updated_at from public.loyalty_offers;
create view public.loyalty_transactions_read with (security_invoker=true) as
select id,user_id,source_id,occurred_at,observed_at,points_delta,type,merchant,receipt_id,
  source_url,description,created_at,updated_at from public.loyalty_transactions;
grant select on public.loyalty_offers_read,public.loyalty_transactions_read to authenticated,service_role;

-- One transaction covers both tables. Repeated source IDs update the same rows;
-- older screenshots/exports never replace a more recently observed source.
create function public.import_loyalty(p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare row jsonb; offers jsonb; transactions jsonb; linked_item uuid; linked_receipt uuid;
  offer_count integer:=0; transaction_count integer:=0; written integer;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Import a loyalty object'; end if;
  offers:=coalesce(p_data->'offers','[]'::jsonb);
  transactions:=coalesce(p_data->'transactions','[]'::jsonb);
  if jsonb_typeof(offers) is distinct from 'array' or jsonb_typeof(transactions) is distinct from 'array' then
    raise exception 'Offers and transactions must be arrays';
  end if;
  if jsonb_array_length(offers)+jsonb_array_length(transactions) not between 1 and 200 then
    raise exception 'Import between 1 and 200 loyalty records';
  end if;
  if exists(select 1 from jsonb_array_elements(offers) v group by trim(v->>'source_id') having count(*)>1) or
    exists(select 1 from jsonb_array_elements(transactions) v group by trim(v->>'source_id') having count(*)>1) then
    raise exception 'Each loyalty record needs a distinct source ID';
  end if;
  for row in select * from jsonb_array_elements(offers) loop
    linked_item:=nullif(row->>'item_id','')::uuid;
    if linked_item is not null and not exists(select 1 from public.items where id=linked_item and user_id=auth.uid()) then
      raise exception 'Item not found';
    end if;
    insert into public.loyalty_offers(user_id,source_id,title,scope,item_id,points,points_multiplier,
      minimum_spend,minimum_quantity,starts_at,ends_at,valid_from,valid_to,terms,source_url,activation_state,observed_at)
    values(auth.uid(),trim(row->>'source_id'),trim(row->>'title'),row->>'scope',linked_item,
      (row->>'points')::integer,(row->>'points_multiplier')::numeric,(row->>'minimum_spend')::numeric,
      (row->>'minimum_quantity')::integer,(row->>'starts_at')::timestamptz,(row->>'ends_at')::timestamptz,
      (row->>'valid_from')::date,(row->>'valid_to')::date,trim(row->>'terms'),row->>'source_url',
      coalesce(row->>'activation_state','unknown'),(row->>'observed_at')::timestamptz)
    on conflict(user_id,source_id) do update set title=excluded.title,scope=excluded.scope,item_id=excluded.item_id,
      points=excluded.points,points_multiplier=excluded.points_multiplier,minimum_spend=excluded.minimum_spend,
      minimum_quantity=excluded.minimum_quantity,starts_at=excluded.starts_at,ends_at=excluded.ends_at,
      valid_from=excluded.valid_from,valid_to=excluded.valid_to,terms=excluded.terms,source_url=excluded.source_url,
      activation_state=excluded.activation_state,observed_at=excluded.observed_at,updated_at=now()
    where excluded.observed_at >= public.loyalty_offers.observed_at;
    get diagnostics written = row_count;
    offer_count:=offer_count+written;
  end loop;
  for row in select * from jsonb_array_elements(transactions) loop
    linked_receipt:=nullif(row->>'receipt_id','')::uuid;
    if linked_receipt is not null and not exists(select 1 from public.receipts where id=linked_receipt and user_id=auth.uid()) then
      raise exception 'Receipt not found';
    end if;
    insert into public.loyalty_transactions(user_id,source_id,occurred_at,observed_at,points_delta,type,
      merchant,receipt_id,source_url,description)
    values(auth.uid(),trim(row->>'source_id'),(row->>'occurred_at')::timestamptz,(row->>'observed_at')::timestamptz,
      (row->>'points_delta')::integer,row->>'type',nullif(trim(row->>'merchant'),''),linked_receipt,
      row->>'source_url',row->>'description')
    on conflict(user_id,source_id) do update set occurred_at=excluded.occurred_at,observed_at=excluded.observed_at,
      points_delta=excluded.points_delta,type=excluded.type,merchant=excluded.merchant,receipt_id=excluded.receipt_id,
      source_url=excluded.source_url,description=excluded.description,updated_at=now()
    where excluded.observed_at >= public.loyalty_transactions.observed_at;
    get diagnostics written = row_count;
    transaction_count:=transaction_count+written;
  end loop;
  return jsonb_build_object('offers',offer_count,'transactions',transaction_count);
end $$;
revoke execute on function public.import_loyalty(jsonb) from public,anon,authenticated;
grant execute on function public.import_loyalty(jsonb) to authenticated;
