-- Hanami campaigns and spreadsheet contact fields. Non-destructive to lead data.
alter table public.leads add column if not exists email text;
alter table public.leads add column if not exists phone text;
alter table public.invitations add column if not exists campaign_id text;

-- Put existing unassigned records in a General campaign so they remain organized.
insert into public.campaigns (id, name, description, owner_id, status)
select '00000000-0000-4000-8000-000000000001', 'General', 'Existing leads and work not yet assigned to a campaign.', id, 'active'
from auth.users where lower(email) = 'charchit.sahoo@peoplehum.com'
on conflict (id) do nothing;
update public.leads set campaign_id = '00000000-0000-4000-8000-000000000001' where campaign_id is null;
update public.companies set campaign_id = '00000000-0000-4000-8000-000000000001' where campaign_id is null;

-- Preserve existing teammates' access to the campaigns already in the workspace.
insert into public.campaign_members(campaign_id, user_id, role)
select c.id, p.user_id, case when p.role = 'viewer' then 'viewer' else 'collaborator' end
from public.profiles p cross join public.campaigns c
where p.user_id not in (select id from auth.users where lower(email) = 'charchit.sahoo@peoplehum.com')
  and not exists (select 1 from public.campaign_members m where m.user_id = p.user_id)
on conflict (campaign_id, user_id) do nothing;

create or replace function public.hanami_can_access_campaign(p_campaign_id text, p_write boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.hanami_is_admin() or exists (
    select 1 from public.campaign_members m
    where m.campaign_id::text = p_campaign_id::text and m.user_id = auth.uid()
      and (not p_write or m.role = 'collaborator')
  )
$$;
revoke all on function public.hanami_can_access_campaign(text, boolean) from public;
grant execute on function public.hanami_can_access_campaign(text, boolean) to authenticated;

drop policy if exists "campaigns read signed in" on public.campaigns;
drop policy if exists "campaigns owner manage" on public.campaigns;
create policy "campaigns read assigned" on public.campaigns for select to authenticated
  using (public.hanami_is_admin() or exists (
    select 1 from public.campaign_members m where m.campaign_id::text = public.campaigns.id::text and m.user_id = auth.uid()
  ));
create policy "campaigns admin manage" on public.campaigns for all to authenticated
  using (public.hanami_is_admin()) with check (public.hanami_is_admin());

drop policy if exists "campaign members read signed in" on public.campaign_members;
drop policy if exists "campaign members admin manage" on public.campaign_members;
create policy "campaign members read self or admin" on public.campaign_members for select to authenticated
  using (user_id = auth.uid() or public.hanami_is_admin());
create policy "campaign members admin manage" on public.campaign_members for all to authenticated
  using (public.hanami_is_admin()) with check (public.hanami_is_admin());

drop policy if exists "leads team read" on public.leads;
drop policy if exists "leads team edit" on public.leads;
create policy "leads read assigned campaign" on public.leads for select to authenticated
  using (public.hanami_can_access_campaign(campaign_id::text, false));
create policy "leads edit assigned campaign" on public.leads for all to authenticated
  using (public.hanami_can_access_campaign(campaign_id::text, true))
  with check (public.hanami_can_access_campaign(campaign_id::text, true));

drop policy if exists "companies read signed in" on public.companies;
drop policy if exists "companies team edit" on public.companies;
create policy "companies read assigned campaign" on public.companies for select to authenticated
  using (public.hanami_can_access_campaign(campaign_id::text, false));
create policy "companies edit assigned campaign" on public.companies for all to authenticated
  using (public.hanami_can_access_campaign(campaign_id::text, true))
  with check (public.hanami_can_access_campaign(campaign_id::text, true));

-- On invitation acceptance, enroll the new account in one campaign or all current campaigns.
create or replace function public.hanami_create_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
declare invite_row public.invitations%rowtype;
begin
  insert into public.profiles(user_id,email,nickname,role,xp,streak)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email,'@',1)),
    case when lower(new.email) = 'charchit.sahoo@peoplehum.com' then 'owner' else coalesce(new.raw_user_meta_data ->> 'role','collaborator') end,
    case when lower(new.email) = 'charchit.sahoo@peoplehum.com' then 445 else 0 end,
    case when lower(new.email) = 'charchit.sahoo@peoplehum.com' then 3 else 0 end)
  on conflict(user_id) do nothing;
  if lower(new.email) <> 'charchit.sahoo@peoplehum.com' then
    select * into invite_row from public.invitations
      where lower(email) = lower(new.email) and status = 'accepted'
      order by accepted_at desc nulls last limit 1;
    if invite_row.campaign_id is null then
      insert into public.campaign_members(campaign_id,user_id,role)
        select id,new.id,coalesce(invite_row.role,'collaborator') from public.campaigns
        on conflict(campaign_id,user_id) do nothing;
    elsif invite_row.id is not null then
      insert into public.campaign_members(campaign_id,user_id,role)
        values (invite_row.campaign_id,new.id,coalesce(invite_row.role,'collaborator'))
        on conflict(campaign_id,user_id) do nothing;
    end if;
  end if;
  return new;
end;
$$;
