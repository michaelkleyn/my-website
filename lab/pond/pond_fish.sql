-- Leave a fish — the pond store, for Postgres (written against Supabase's PostgREST conventions:
-- the page reads the table through /rest/v1/pond_fish and writes through /rest/v1/rpc/leave_fish).
-- Policy: the pond keeps the newest 30 fish (a new arrival retires the oldest); the same design is never
-- stored twice; one fish per visitor (leaving another replaces it). Rows are ~300 bytes each.

create extension if not exists pgcrypto;

create table if not exists pond_fish (
  id         text primary key default encode(gen_random_bytes(9), 'hex'),
  name       text not null check (char_length(name) between 1 and 16),
  params     jsonb not null,
  hash       text not null unique,          -- "unique fish": same design → same hash → refused
  secret     text not null,                 -- lets a visitor replace their own fish; never readable
  created_at timestamptz not null default now()
);
create index if not exists pond_fish_created on pond_fish (created_at);

-- Anyone may read the pond, but only the columns the page needs. The secret never leaves the database.
alter table pond_fish enable row level security;
drop policy if exists pond_read on pond_fish;
create policy pond_read on pond_fish for select to anon, authenticated using (true);
revoke all on pond_fish from anon, authenticated;
grant select (id, name, params, created_at) on pond_fish to anon, authenticated;

-- A design is valid when it is exactly what the page's normalizeDesign() produces.
create or replace function pond_valid(p jsonb) returns boolean language plpgsql immutable as $$
declare k text; c text; i int;
begin
  if p is null or jsonb_typeof(p) <> 'object' or length(p::text) > 600 then return false; end if;
  if not (p->>'style' in ('koi', 'minnow', 'pencil')) then return false; end if;
  foreach k in array array['len', 'belly', 'tail', 'fin', 'size'] loop
    if jsonb_typeof(p->k) <> 'number' or (p->>k)::numeric not between 0 and 1 then return false; end if;
  end loop;
  if jsonb_typeof(p->'colors') <> 'array' or jsonb_array_length(p->'colors') <> 5 then return false; end if;
  for i in 0..4 loop
    c := p->'colors'->>i;
    if c is null or c !~ '^#[0-9a-f]{6}$' then return false; end if;
  end loop;
  if not (p->>'pattern' in ('plain', 'kohaku', 'sanke', 'showa', 'bekko', 'tancho', 'asagi')) then return false; end if;
  if jsonb_typeof(p->'markScale') <> 'number' or (p->>'markScale')::numeric not between 0.5 and 2 then return false; end if;
  if jsonb_typeof(p->'markDensity') <> 'number' or (p->>'markDensity')::numeric not between 0.3 and 2 then return false; end if;
  if jsonb_typeof(p->'seed') <> 'number' or (p->>'seed')::numeric not between 0 and 9999 then return false; end if;
  return true;
end $$;

-- leave_fish(name, design, visitor secret, id of the visitor's earlier fish or null) → the stored fish.
-- Validates, rate-limits (six arrivals per ten minutes, pond-wide), replaces the caller's earlier fish,
-- refuses a duplicate design, inserts, then retires whatever is older than the newest 30.
create or replace function leave_fish(p_name text, p_params jsonb, p_secret text, p_replace text default null)
returns json language plpgsql security definer set search_path = public as $$
declare cap int := 30; nm text; h text; r pond_fish;
begin
  nm := left(btrim(regexp_replace(coalesce(p_name, ''), '[^[:alnum:] .''\-]', '', 'g')), 16);
  if nm = '' then raise exception 'Give it a name first.'; end if;
  if not pond_valid(p_params) then raise exception 'That design did not parse.'; end if;
  if p_secret is null or char_length(p_secret) < 12 then raise exception 'Missing visitor token.'; end if;
  if (select count(*) from pond_fish where created_at > now() - interval '10 minutes') >= 6 then
    raise exception 'The pond is busy — try again in a few minutes.';
  end if;
  if p_replace is not null then delete from pond_fish where id = p_replace and secret = p_secret; end if;
  h := md5(p_params::text);   -- jsonb text is canonical (sorted keys), so the same design always hashes the same
  if exists (select 1 from pond_fish where hash = h) then
    raise exception 'That exact fish already lives here — change something about it.';
  end if;
  insert into pond_fish (name, params, hash, secret) values (nm, p_params, h, p_secret) returning * into r;
  delete from pond_fish where id in (select id from pond_fish order by created_at desc offset cap);
  return json_build_object('id', r.id, 'name', r.name, 'params', r.params, 'created_at', r.created_at);
end $$;

-- retire_fish(id, secret) → true when the caller's fish was removed.
create or replace function retire_fish(p_id text, p_secret text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  delete from pond_fish where id = p_id and secret = p_secret;
  return found;
end $$;

revoke all on function leave_fish(text, jsonb, text, text) from public;
grant execute on function leave_fish(text, jsonb, text, text) to anon, authenticated;
revoke all on function retire_fish(text, text) from public;
grant execute on function retire_fish(text, text) to anon, authenticated;
revoke all on function pond_valid(jsonb) from public;
