-- Company directory fields and durable company-to-lead relationships.
-- Safe to run more than once; existing company and lead rows are preserved.
alter table public.companies add column if not exists sector text;
alter table public.companies add column if not exists hq_phone text;
alter table public.leads add column if not exists company_id text references public.companies(id) on delete set null;
create index if not exists leads_company_id_idx on public.leads(company_id);
