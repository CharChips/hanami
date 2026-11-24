-- ==============================================================================
-- HANAMI LEAD GARDEN - SUPABASE DATABASE INITIALIZATION & SCHEMA
-- ==============================================================================
-- Does not delete tables or rows. Replaces prior RLS policies with role-aware policies.
-- ==============================================================================

-- 1. PROFILES TABLE (User Accounts & Roles)
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  nickname text,
  role text default 'owner', -- 'owner', 'collaborator', 'viewer'
  xp integer default 0,
  streak integer default 0,
  last_day text,
  today jsonb default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- 2. CAMPAIGNS TABLE (Multiple campaigns setup)
create table if not exists public.campaigns (
  id text primary key,
  name text not null,
  description text,
  owner_id uuid references auth.users(id) on delete cascade,
  status text default 'active', -- 'active', 'paused', 'archived'
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- 3. CAMPAIGN MEMBERS TABLE (Collaborators & Roles per Campaign)
create table if not exists public.campaign_members (
  id uuid primary key default gen_random_uuid(),
  campaign_id text references public.campaigns(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text not null default 'collaborator', -- 'owner', 'collaborator', 'viewer'
  created_at timestamp with time zone default timezone('utc'::text, now()),
  unique(campaign_id, user_id)
);

-- 4. INVITATIONS TABLE (Team Collaborator Invites)
create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  role text default 'collaborator', -- 'collaborator', 'viewer'
  invited_by text default 'charchit.sahoo@peoplehum.com',
  campaign_id text,
  token text not null,
  status text default 'pending', -- 'pending', 'accepted'
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- 5. LEADS TABLE (Prospects in Garden)
create table if not exists public.leads (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade,
  campaign_id text references public.campaigns(id) on delete set null,
  name text not null,
  linkedin_url text,
  role text,
  country text,
  status text default 'spotted',
  due text,
  next_step text,
  note text,
  hot boolean default false,
  photo text,
  log jsonb default '[]'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- 6. COMPANIES TABLE (Huts)
create table if not exists public.companies (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade,
  campaign_id text references public.campaigns(id) on delete set null,
  name text not null,
  country text,
  sector text,
  hq_phone text,
  status text default 'building',
  note text,
  log jsonb default '[]'::jsonb,
  done text,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- Ensure non-destructive addition of columns to existing tables
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists role text default 'owner';
alter table public.profiles add column if not exists xp integer default 0;
alter table public.profiles add column if not exists streak integer default 0;
alter table public.profiles add column if not exists last_day text;
alter table public.profiles add column if not exists today jsonb default '{}'::jsonb;

alter table public.leads add column if not exists campaign_id text references public.campaigns(id) on delete set null;
alter table public.leads add column if not exists log jsonb default '[]'::jsonb;
alter table public.leads add column if not exists hot boolean default false;
alter table public.leads add column if not exists photo text;
alter table public.leads add column if not exists company_id text references public.companies(id) on delete set null;

alter table public.companies add column if not exists campaign_id text references public.campaigns(id) on delete set null;
alter table public.companies add column if not exists log jsonb default '[]'::jsonb;
alter table public.companies add column if not exists done text;
alter table public.companies add column if not exists sector text;
alter table public.companies add column if not exists hq_phone text;
create index if not exists leads_company_id_idx on public.leads(company_id);
alter table public.invitations add column if not exists invited_by_id uuid references auth.users(id) on delete cascade;
alter table public.invitations add column if not exists expires_at timestamptz default (now() + interval '7 days');
alter table public.invitations add column if not exists accepted_at timestamptz;
create unique index if not exists invitations_token_unique on public.invitations(token);

-- Normalize legacy account roles; only the fixed email is an owner.
update public.profiles
set role = case when role = 'viewer' then 'viewer' else 'collaborator' end
where user_id not in (
  select id from auth.users where lower(email) = 'charchit.sahoo@peoplehum.com'
);

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================
alter table public.profiles enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_members enable row level security;
alter table public.invitations enable row level security;
alter table public.leads enable row level security;
alter table public.companies enable row level security;

-- Remove the former blanket policies, including anonymous read/write access.
do $$
declare p record;
begin
  for p in select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('profiles','campaigns','campaign_members','invitations','leads','companies')
  loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;
drop policy if exists "Profiles auth access" on public.profiles;
drop policy if exists "Profiles anon read" on public.profiles;
drop policy if exists "Campaigns auth access" on public.campaigns;
drop policy if exists "Campaign members auth access" on public.campaign_members;
drop policy if exists "Invitations public access" on public.invitations;
drop policy if exists "Leads auth access" on public.leads;
drop policy if exists "Leads anon access" on public.leads;
drop policy if exists "Companies auth access" on public.companies;
drop policy if exists "Companies anon access" on public.companies;

create or replace function public.hanami_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = 'charchit.sahoo@peoplehum.com'
$$;
revoke all on function public.hanami_is_admin() from public;
grant execute on function public.hanami_is_admin() to authenticated;

create or replace function public.hanami_can_edit()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.hanami_is_admin() or exists (
    select 1 from public.profiles where user_id = auth.uid() and role = 'collaborator'
  )
$$;
revoke all on function public.hanami_can_edit() from public;
grant execute on function public.hanami_can_edit() to authenticated;

-- Gate account creation to the fixed admin or an email-bound, unexpired invite.
create or replace function public.hanami_gate_signup()
returns trigger language plpgsql security definer set search_path = '' as $$
declare inv public.invitations%rowtype;
begin
  if lower(new.email) = 'charchit.sahoo@peoplehum.com' then
    new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('role','owner');
    return new;
  end if;
  select * into inv from public.invitations
   where lower(email) = lower(new.email)
     and token = new.raw_user_meta_data ->> 'invite_token'
     and status = 'pending' and expires_at > now()
   limit 1;
  if inv.id is null then
    raise exception 'Account creation requires a valid Hanami invitation';
  end if;
  new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('role', inv.role);
  update public.invitations set status = 'accepted', accepted_at = now() where id = inv.id;
  return new;
end;
$$;
drop trigger if exists hanami_gate_signup on auth.users;
create trigger hanami_gate_signup before insert on auth.users
for each row execute function public.hanami_gate_signup();

create or replace function public.hanami_create_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(user_id,email,nickname,role,xp,streak)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email,'@',1)),
    case when lower(new.email) = 'charchit.sahoo@peoplehum.com' then 'owner' else coalesce(new.raw_user_meta_data ->> 'role','collaborator') end,
    case when lower(new.email) = 'charchit.sahoo@peoplehum.com' then 445 else 0 end,
    case when lower(new.email) = 'charchit.sahoo@peoplehum.com' then 3 else 0 end)
  on conflict(user_id) do nothing;
  return new;
end;
$$;
drop trigger if exists hanami_create_profile on auth.users;
create trigger hanami_create_profile after insert on auth.users
for each row execute function public.hanami_create_profile();

create or replace function public.hanami_lock_self_role()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() = old.user_id and not public.hanami_is_admin() and new.role is distinct from old.role then
    raise exception 'Only the workspace admin can change account roles';
  end if;
  return new;
end;
$$;
drop trigger if exists hanami_lock_self_role on public.profiles;
create trigger hanami_lock_self_role before update on public.profiles
for each row execute function public.hanami_lock_self_role();

create policy "profiles read self or admin" on public.profiles for select to authenticated
  using (user_id = auth.uid() or public.hanami_is_admin());
create policy "profiles insert self" on public.profiles for insert to authenticated
  with check (user_id = auth.uid() and (role in ('collaborator','viewer') or public.hanami_is_admin()));
create policy "profiles update self or admin" on public.profiles for update to authenticated
  using (user_id = auth.uid() or public.hanami_is_admin())
  with check ((user_id = auth.uid() and role in ('collaborator','viewer')) or public.hanami_is_admin());

create policy "campaigns read signed in" on public.campaigns for select to authenticated using (true);
create policy "campaigns owner manage" on public.campaigns for all to authenticated
  using (public.hanami_is_admin()) with check (public.hanami_is_admin());
create policy "campaign members read signed in" on public.campaign_members for select to authenticated using (true);
create policy "campaign members admin manage" on public.campaign_members for all to authenticated
  using (public.hanami_is_admin()) with check (public.hanami_is_admin());

create policy "invitations admin read" on public.invitations for select to authenticated using (public.hanami_is_admin());
create policy "invitations invitee read" on public.invitations for select to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'));
create policy "invitations invitee accept" on public.invitations for update to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email') and status = 'pending' and expires_at > now())
  with check (lower(email) = lower(auth.jwt() ->> 'email') and status = 'accepted');

create policy "leads team read" on public.leads for select to authenticated using (true);
create policy "leads team edit" on public.leads for all to authenticated
  using (public.hanami_can_edit()) with check (public.hanami_can_edit());
create policy "companies read signed in" on public.companies for select to authenticated using (true);
create policy "companies team edit" on public.companies for all to authenticated
  using (public.hanami_can_edit()) with check (public.hanami_can_edit());

-- ==============================================================================
-- Promote the designated admin only; do not claim all user data.
-- ==============================================================================
-- If the designated admin already exists, promote the profile without moving lead data.
do $$
declare
  target_id uuid;
begin
  select id into target_id from auth.users where lower(email) = 'charchit.sahoo@peoplehum.com' limit 1;
  if target_id is not null then
    insert into public.profiles (user_id, email, nickname, role, xp, streak)
    values (target_id, 'charchit.sahoo@peoplehum.com', 'Charchit', 'owner', 445, 3)
    on conflict (user_id) do update set
      role = 'owner',
      email = 'charchit.sahoo@peoplehum.com',
      nickname = 'Charchit',
      xp = greatest(public.profiles.xp, 445),
      streak = greatest(public.profiles.streak, 3);
  end if;
end $$;
