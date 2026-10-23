-- Keep dated observations as history; a sale has its own validity and source identity.
-- Nullable timestamps preserve the inclusive Toronto date semantics of existing offers.
alter table public.offers
  add column starts_at timestamptz,
  add column ends_at timestamptz,
  add column points integer not null default 0,
  add column loyalty_program text,
  add column source_provider text,
  add column source_id text,
  add constraint offers_exact_interval check (
    (starts_at is null and ends_at is null) or
    (starts_at is not null and ends_at is not null and
      isfinite(starts_at) and isfinite(ends_at) and ends_at > starts_at)
  ),
  add constraint offers_points_program check (
    points >= 0 and (loyalty_program is null or loyalty_program = 'PC Optimum') and
    (points = 0 or loyalty_program is not null)
  ),
  add constraint offers_source_identity check (
    (source_provider is null and source_id is null) or
    (source_provider is not null and source_id is not null and
      length(trim(source_provider)) between 1 and 100 and
      length(trim(source_id)) between 1 and 250)
  ),
  add constraint offers_source_unique unique(user_id, source_provider, source_id);

create index offers_owner_interval on public.offers(user_id, valid_from, valid_to);
create index observations_latest_item on public.observations(user_id, item_id, observed_on desc, created_at desc, id desc);

-- Append columns without changing the existing view's column names/types/order.
create or replace view public.offers_read with (security_invoker=true) as
select id,user_id,item_id,price::text,package_size::text,unit,regular_price::text,
  valid_from,valid_to,source_url,channel,conditions,created_at,
  starts_at,ends_at,points,loyalty_program,source_provider,source_id
from public.offers;

-- One row per tracked item, including items that do not have a recorded cost yet.
-- A package price and its normalized unit cost stay separate; no points are deducted.
create view public.item_unit_costs with (security_invoker=true) as
select i.id as item_id,i.user_id,i.name,i.category,i.comparison_group,
  o.id as observation_id,o.price::text as package_price,o.package_size::text,o.unit,
  case when o.package_size > 0 and o.unit is not null then
    (o.price / (o.package_size / case when o.unit in ('g','ml') then 1000::numeric else 1::numeric end))::text
  end as comparable_unit_price,
  case when o.package_size > 0 then
    case when o.unit in ('g','kg') then 'kg' when o.unit in ('ml','l') then 'L'
      when o.unit = 'count' then 'each' end
  end as comparable_unit,
  o.store_name,o.branch_id,o.observed_on,o.channel,o.source,o.source_url
from public.items i
left join lateral (
  select * from public.observations
  where item_id=i.id and user_id=i.user_id
  order by observed_on desc,created_at desc,id desc limit 1
) o on true;

grant select on public.offers_read,public.item_unit_costs to authenticated,service_role;

create or replace function public.import_offers(p_rows jsonb) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare row jsonb; oid uuid; branch text; count integer:=0;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Import an array of offers'; end if;
  if jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'Import 1 to 500 offers'; end if;
  for row in select * from jsonb_array_elements(p_rows) loop
    if not exists(select 1 from public.items where id=(row->>'item_id')::uuid and user_id=auth.uid()) then
      raise exception 'Item not found';
    end if;
    if jsonb_typeof(row->'branch_ids') is distinct from 'array' then
      raise exception 'Choose at least one applicable branch';
    end if;
    if jsonb_array_length(row->'branch_ids') not between 1 and 30 then
      raise exception 'Choose between 1 and 30 applicable branches';
    end if;
    insert into public.offers(user_id,item_id,price,package_size,unit,regular_price,
      valid_from,valid_to,source_url,channel,conditions,starts_at,ends_at,points,
      loyalty_program,source_provider,source_id)
    values(auth.uid(),(row->>'item_id')::uuid,(row->>'price')::numeric,
      nullif(row->>'package_size','')::numeric,nullif(row->>'unit',''),
      nullif(row->>'regular_price','')::numeric,(row->>'valid_from')::date,
      (row->>'valid_to')::date,row->>'source_url',coalesce(row->>'channel','in-store'),
      coalesce(row->>'conditions',''),nullif(row->>'starts_at','')::timestamptz,
      nullif(row->>'ends_at','')::timestamptz,coalesce((row->>'points')::integer,0),
      nullif(row->>'loyalty_program',''),nullif(trim(row->>'source_provider'),''),
      nullif(trim(row->>'source_id'),''))
    on conflict (user_id,source_provider,source_id) do update set
      item_id=excluded.item_id,price=excluded.price,package_size=excluded.package_size,
      unit=excluded.unit,regular_price=excluded.regular_price,valid_from=excluded.valid_from,
      valid_to=excluded.valid_to,source_url=excluded.source_url,channel=excluded.channel,
      conditions=excluded.conditions,starts_at=excluded.starts_at,ends_at=excluded.ends_at,
      points=excluded.points,loyalty_program=excluded.loyalty_program
    returning id into oid;
    delete from public.offer_stores where offer_id=oid and user_id=auth.uid();
    for branch in select distinct jsonb_array_elements_text(row->'branch_ids') loop
      insert into public.offer_stores(offer_id,branch_id,user_id) values(oid,branch::uuid,auth.uid());
    end loop;
    count:=count+1;
  end loop;
  return count;
end $$;

revoke execute on function public.import_offers(jsonb) from public,anon,authenticated;
grant execute on function public.import_offers(jsonb) to authenticated;
