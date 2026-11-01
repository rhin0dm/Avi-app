-- Research briefs (e.g. produced by an outside AI research agent) and score provenance.
alter table scores add column if not exists source text;
alter table evidence add column if not exists source_note text;

create table if not exists research_briefs (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid references opportunities(id) on delete set null,
  opportunity_code text,
  title text not null,
  version text,
  analyst text,
  prepared_on date,
  content text not null,
  content_sha256 text not null unique,
  parsed jsonb not null default '{}',
  imported_at timestamptz not null default now()
);
create index if not exists research_briefs_opportunity on research_briefs (opportunity_id);
alter table research_briefs enable row level security;
