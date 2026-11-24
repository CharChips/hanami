-- Allows the trusted service-role removal function to detach a deleted account
-- from lead creator UUIDs while keeping the readable creator name on each lead.
-- Ordinary users still cannot rewrite creator attribution through lead edits.
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
    if auth.role() = 'service_role' and new.created_by is null then
      new.created_by := null;
      new.created_by_name := old.created_by_name;
    else
      new.created_by := old.created_by;
      new.created_by_name := old.created_by_name;
    end if;
  end if;
  return new;
end;
$$;
