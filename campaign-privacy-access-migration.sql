-- Personal/team lead visibility plus campaign member management.
-- Existing leads remain team-visible; their original author is unknown because
-- user_id may have been reassigned by the legacy owner-claim flow.

alter table public.leads
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists created_by_name text,
  add column if not exists visibility text not null default 'team';

update public.leads
set visibility = 'team', created_by_name = coalesce(created_by_name, 'Before tracking')
where visibility is null or created_by_name is null;

alter table public.leads drop constraint if exists leads_visibility_check;
alter table public.leads add constraint leads_visibility_check
  check (visibility in ('team', 'private'));

create or replace function public.hanami_set_lead_creator()
returns trigger language plpgsql security definer set search_path = '' as $$
declare creator_name text;
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    select nullif(btrim(p.nickname), '') into creator_name
      from public.profiles p where p.user_id = auth.uid();
    new.created_by_name := coalesce(creator_name, split_part(auth.jwt() ->> 'email', '@', 1), 'Team member');
  else
    -- Service-role account removal may clear the auth.users reference while
    -- retaining the visible creator name on the lead.
    if auth.role() = 'service_role' and new.created_by is null then
      new.created_by := null;
      new.created_by_name := old.created_by_name;
    else
      -- Upserts may execute the INSERT trigger before an UPDATE on conflict.
      -- Preserve the original creator so edits never rewrite attribution.
      new.created_by := old.created_by;
      new.created_by_name := old.created_by_name;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.hanami_set_lead_creator() from public;
drop trigger if exists hanami_set_lead_creator on public.leads;
create trigger hanami_set_lead_creator
  before insert or update on public.leads
  for each row execute function public.hanami_set_lead_creator();

drop policy if exists "leads team read" on public.leads;
drop policy if exists "leads team edit" on public.leads;
drop policy if exists "leads read assigned campaign" on public.leads;
drop policy if exists "leads edit assigned campaign" on public.leads;
drop policy if exists "leads select visible campaign" on public.leads;
drop policy if exists "leads insert assigned campaign" on public.leads;
drop policy if exists "leads update visible campaign" on public.leads;
drop policy if exists "leads delete visible campaign" on public.leads;

create policy "leads select visible campaign" on public.leads
  for select to authenticated
  using (
    public.hanami_can_access_campaign(campaign_id::text, false)
    and (
      coalesce(visibility, 'team') = 'team'
      or created_by = auth.uid()
      or public.hanami_is_admin()
    )
  );

create policy "leads insert assigned campaign" on public.leads
  for insert to authenticated
  with check (
    public.hanami_can_access_campaign(campaign_id::text, true)
    and (created_by = auth.uid() or public.hanami_is_admin())
    and coalesce(visibility, 'team') in ('team', 'private')
  );

create policy "leads update visible campaign" on public.leads
  for update to authenticated
  using (
    public.hanami_can_access_campaign(campaign_id::text, true)
    and (
      coalesce(visibility, 'team') = 'team'
      or created_by = auth.uid()
      or public.hanami_is_admin()
    )
  )
  with check (
    public.hanami_can_access_campaign(campaign_id::text, true)
    and (
      coalesce(visibility, 'team') = 'team'
      or created_by = auth.uid()
      or public.hanami_is_admin()
    )
  );

create policy "leads delete visible campaign" on public.leads
  for delete to authenticated
  using (
    public.hanami_can_access_campaign(campaign_id::text, true)
    and (
      coalesce(visibility, 'team') = 'team'
      or created_by = auth.uid()
      or public.hanami_is_admin()
    )
  );

