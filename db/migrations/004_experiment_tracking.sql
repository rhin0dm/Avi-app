-- Experiment tracking sheets (e.g. EXP-002r1) and non-brief documents attached to an idea.
alter table experiments add column if not exists tracking jsonb;
alter table experiments add column if not exists tracking_updated_at timestamptz;
alter table research_briefs add column if not exists kind text not null default 'brief';
