-- Workbook v1.3/v1.4 support: niche profile, parent links, competitors, niche scan backlog,
-- richer experiments, and evidence raw rows (for safe re-import updates).
alter table opportunities add column if not exists parent_code text;
alter table opportunities add column if not exists niche jsonb;
alter table opportunities add column if not exists research_brief_file text;
alter table evidence add column if not exists import_raw jsonb;
alter table experiments add column if not exists opportunity_code text;
alter table experiments add column if not exists details jsonb;

create table if not exists competitors (
  id uuid primary key default gen_random_uuid(),
  opportunity_code text,
  opportunity_id uuid references opportunities(id) on delete set null,
  name text not null,
  alt_type text,
  price text,
  price_date text,
  coverage text,
  switching_friction text,
  gap text,
  source_text text,
  source_url text,
  checked_on text,
  import_key text unique,
  updated_at timestamptz not null default now()
);
create index if not exists competitors_opportunity on competitors (opportunity_id);

create table if not exists niche_scans (
  id uuid primary key default gen_random_uuid(),
  scan_id text unique,
  niche text not null,
  source text,
  observed_on text,
  why_interesting text,
  promoted text,
  updated_at timestamptz not null default now()
);

alter table competitors enable row level security;
alter table niche_scans enable row level security;
