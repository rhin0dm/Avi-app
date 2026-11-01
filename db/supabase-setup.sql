-- AVI database setup for Supabase. Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Generated from db/migrations/001_init.sql. Safe to run once on an empty project.

create table if not exists schema_migrations (name text primary key, applied_at timestamptz default now());

-- AVI Phase 1 schema. Plain PostgreSQL (works on Supabase, Neon, RDS or local).
-- The app reaches the database only from the server with DATABASE_URL.
-- Row Level Security is enabled with no policies, so Supabase's public
-- REST/anon API cannot read or write these tables.

create extension if not exists pgcrypto;

-- Starts at 26: the original register holds AVI-001..AVI-025 and its Idea Intake sheet reserves AVI-026 as the next ID.
create sequence if not exists opportunity_code_seq start 26;

create table opportunities (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null check (char_length(name) between 1 and 300),
  normalized_name text not null,
  description text,
  core_hypothesis text,
  target_customer text,
  problem text,
  business_models text,
  revenue_mechanisms text,
  assumptions text,
  track text check (track in ('cash','balanced','growth')),
  stage text not null default 'idea' check (stage in
    ('idea','research','investigate','validation','build','launch','scale','hold','reject','archive')),
  customer_contact text,
  target_market text,
  proposed_pricing text,
  budget_aud numeric(14,2),
  test_budget_low_aud numeric(14,2),
  test_budget_high_aud numeric(14,2),
  user_evidence text,
  relevant_experience text,
  notes text,
  primary_risks text,
  competitor_leads text,
  next_action text,
  next_review_date date,
  last_reviewed_date date,
  owner text,
  revenue_assumptions text,
  actual_test_spend_aud numeric(14,2) not null default 0,
  verified_revenue_aud numeric(14,2) not null default 0,
  -- preserved from the original register; never overwritten by rescoring
  legacy_rank integer,
  legacy_score numeric(6,2),
  legacy_decision text,
  legacy_validation_status text,
  legacy_evidence_status text,
  -- import provenance
  import_source text,
  import_key text unique,
  import_raw jsonb,
  -- AI interpretation (always labelled as AI inference, never evidence)
  interpretation jsonb,
  interpretation_status text not null default 'not_requested'
    check (interpretation_status in ('not_requested','queued','running','completed','failed','not_configured')),
  merged_into_id uuid references opportunities(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on opportunities (stage);
create index on opportunities (normalized_name);

create table scoring_versions (
  id serial primary key,
  label text not null,
  weights jsonb not null,          -- { criterionKey: percent }
  thresholds jsonb not null,       -- { pass, investigate, minEvidenceConfidence }
  is_active boolean not null default false,
  is_legacy boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);
create unique index scoring_versions_one_active on scoring_versions (is_active) where is_active;

create table scores (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  scoring_version_id integer not null references scoring_versions(id),
  criteria jsonb not null default '[]',
  gates jsonb not null default '[]',
  weighted_total numeric(6,2),
  evidence_confidence numeric(5,3),
  decision text not null check (decision in ('PASS','INVESTIGATE','FAIL','UNSCORED','LEGACY')),
  decision_reasons jsonb not null default '[]',
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);
create index on scores (opportunity_id, created_at desc);
create unique index scores_one_current on scores (opportunity_id) where is_current and decision <> 'LEGACY';

create table financial_models (
  opportunity_id uuid primary key references opportunities(id) on delete cascade,
  inputs jsonb not null,
  scenarios jsonb not null,
  updated_at timestamptz not null default now()
);

create table evidence (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  claim text not null,
  classification text not null check (classification in
    ('verified','credible_secondary','inference','estimate','unsupported')),
  original_classification text,
  source_url text,
  retrieved_on date,
  scope text,
  limitations text,
  relevant_to text,
  action_required text,
  import_key text unique,
  created_at timestamptz not null default now()
);

create table opportunity_evidence (
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  evidence_id uuid not null references evidence(id) on delete cascade,
  primary key (opportunity_id, evidence_id)
);

create table experiments (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  opportunity_id uuid references opportunities(id) on delete set null,
  hypothesis text,
  design text,
  success_metric text,
  success_threshold text,
  budget_aud numeric(14,2),
  start_date date,
  end_date date,
  status text not null default 'planned',
  actual_spend_aud numeric(14,2) not null default 0,
  result text,
  evidence_url text,
  decision text,
  lessons text,
  import_key text unique,
  created_at timestamptz not null default now()
);

create table decision_history (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid references opportunities(id) on delete cascade,
  decided_on date not null default current_date,
  old_score text,
  new_score text,
  old_decision text,
  new_decision text,
  reason text,
  source text,
  import_key text unique,
  created_at timestamptz not null default now()
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid references opportunities(id) on delete cascade,
  kind text not null,
  status text not null check (status in ('queued','running','completed','failed','needs_review')),
  error text,
  result jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create table audit_log (
  id bigserial primary key,
  entity text not null,
  entity_id text,
  action text not null,
  changes jsonb,
  at timestamptz not null default now()
);
create index on audit_log (entity, entity_id, at desc);

create table settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table import_runs (
  id uuid primary key default gen_random_uuid(),
  filename text,
  file_sha256 text not null,
  summary jsonb not null,
  at timestamptz not null default now()
);

-- Lock the tables away from Supabase's anon/authenticated REST roles.
do $$
declare t text;
begin
  foreach t in array array['opportunities','scoring_versions','scores','financial_models','evidence',
    'opportunity_evidence','experiments','decision_history','jobs','audit_log','settings','import_runs']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- Seed: the brief's scoring model as the active version, plus the workbook's
-- original screening model kept as a legacy version for provenance.
insert into scoring_versions (label, weights, thresholds, is_active, notes) values
 ('AVI v1 (earnings-first)',
  '{"earnings":35,"demand":20,"acquisition":15,"ai_leverage":15,"operational_burden":10,"capital_risk":5}',
  '{"pass":80,"investigate":60,"minEvidenceConfidence":0.65}', true,
  'Initial weights from the AVI build brief and Evaluator Rules sheet.');
insert into scoring_versions (label, weights, thresholds, is_active, is_legacy, notes) values
 ('Original register screening v1.0',
  '{"income_potential":25,"low_customer_interaction":20,"ai_leverage_scalability":20,"speed_to_first_revenue":15,"low_startup_cost_risk":10,"personal_advantage":10}',
  '{}', false, true,
  'Subjective preliminary totals from the original workbook. Criteria were not individually scored.');

insert into settings (key, value) values
 ('runway', '{"savingsAud":null,"monthlyPersonalSpendAud":null,"resignationDate":"2027-02-28","currentSalaryAud":160000}');

insert into schema_migrations (name) values ('001_init.sql');
alter table schema_migrations enable row level security;
