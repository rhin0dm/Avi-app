# AVI — AI Venture Intelligence

A private platform for finding, scoring, modelling and tracking business opportunities. Phase 1 (working foundation) is complete.

**Stack:** Next.js 16 (App Router, TypeScript) · Tailwind CSS 4 · PostgreSQL (Supabase in production) · postgres.js · Zod · Vitest.

Deployment steps for Supabase + Vercel are in **[DEPLOY.md](DEPLOY.md)**.

## What Phase 1 does

| Module | Status |
|---|---|
| Decision Centre dashboard (counts, top ranked, attention list, reject list, evidence gaps, reviews, ventures, runway, risk, recent decisions) | Working |
| Idea submission → saved first with unique `AVI-###` code, duplicate detection | Working |
| AI interpretation of ideas (customer, problem, models, revenue, assumptions, risks) | Working code; needs `ANTHROPIC_API_KEY`. Tested with a stubbed API, **not yet against the live API** |
| Opportunity register with search, filters, sort, multi-select | Working |
| Deterministic scoring engine (6 weighted criteria, 5 critical gates, evidence tags) | Working |
| PASS / INVESTIGATE / FAIL rules, evidence confidence kept separate from score | Working |
| Versioned scoring weights with rescore-all and history | Working |
| Financial model: recurring/one-off, churn, CAC, LTV, break-even, payback, peak cash, owner earnings, 3 scenarios, ±20% sensitivity, multi-currency | Working |
| Opportunity detail: edit, score, model, evidence, history/audit, stage moves, merge, reopen | Working |
| Comparison with ranked recommendation (decision tier → evidence-adjusted score; never revenue alone) | Working |
| Excel import (preview, then commit; idempotent), Excel/CSV/JSON export | Working |
| Evidence library: link to opportunities, reclassify | Working |
| Single-owner sign-in, server-only secrets, input validation, audit log, RLS lockout | Working |

### Deliberately not in Phase 1
- **Live market research, competitor analysis, citations, research jobs** (Phase 2). Evidence imported from your register is kept and marked *Unverified*; nothing is invented.
- **Experiment management** (Phase 3). Your 5 planned experiments are imported and shown read-only; the dashboard counts them.
- **Opportunity Scout and scheduled discovery** (Phase 3). Nothing pretends to run in the background.
- **Revenue/cost tracking beyond the register's "Actual test spend" and "Verified revenue" fields** (Phase 3).

## Scoring rules (code: `src/lib/scoring.ts`)

Weighted total = Σ(score × weight) using integer arithmetic, so the same inputs always give the same result (matches the workbook's `ROUND((C*35+D*20+…)/10,1)`).

1. Any gate marked **blocker** → **FAIL**, whatever the score.
2. Score < 60 → **FAIL**.
3. Score ≥ 80 → **PASS** only if evidence confidence ≥ 65%, the demand score rests on verified/credible evidence, and all five gates are *satisfied* on verified/credible evidence. Otherwise **INVESTIGATE** with the reasons listed.
4. Otherwise → **INVESTIGATE**.

Evidence confidence = weight-averaged evidence strength (verified 1.0, credible secondary 0.75, inference 0.4, estimate 0.3, unsupported 0). An AI-optimistic all-10s score on inference evidence cannot PASS.

## Importing the Master Opportunity Register

- Reads *Opportunity Register*, *Evidence & Sources*, *Experiment Log* and *Decision History* by their column headers.
- New ideas on *Idea Intake* are imported too, combined with their *Idea Evaluations* row, any *Validation Tests* (as experiments) and any brief sheet titled `AVI-0xx | …`. Evaluation scores are not copied — re-enter them on the Score tab with evidence tags.
- Keeps every original column (in `import_raw`), the original rank and score (as a separate **legacy** scoring version), and original statuses.
- Imported opportunities start **Not scored** under the AVI model — the original ranks are not treated as validated.
- Evidence keeps its original classification text; all of it is stored as *Unverified* until you check it.
- Only explicit "Evidence reference IDs" create links. E04–E10 are imported but unlinked (the register only names them in free text); link them on the Evidence page.
- Example rows ("EXAMPLE ONLY", "Example:") are skipped. Re-importing never duplicates (matched by normalised name).
- Includes its own tolerant .xlsx reader because your workbook uses namespace-prefixed XML that common libraries reject.

## Tests

```bash
npm test                 # 45 unit + integration tests (needs a Postgres at TEST_DATABASE_URL)
npm run test:e2e         # the brief's 10 acceptance tests over HTTP against a running app
```

`TEST_DATABASE_URL` defaults to `postgres://postgres@localhost:5432/avi_test`; the integration tests wipe that database. The e2e run needs `AVI_BASE_URL` (default `http://localhost:3000`) and `AVI_OWNER_PASSWORD`, and writes records, so point it at a disposable database. If `local-data/register.xlsx` exists, an extra test imports your real workbook (that folder is git-ignored).

## Local development

```bash
cp .env.example .env.local     # fill in values
npm install
npm run db:migrate
npm run dev
```

## Project layout

```
db/migrations/        SQL schema (plain Postgres)
db/supabase-setup.sql paste-in version for the Supabase SQL editor
scripts/migrate.ts    migration runner
src/lib/scoring.ts    deterministic scoring + decision rules
src/lib/finance.ts    financial model, scenarios, sensitivity
src/lib/importer.ts   workbook import (plan → commit)
src/lib/xlsxReader.ts tolerant .xlsx reader
src/lib/exporter.ts   xlsx / csv / json export
src/lib/repo.ts       database access + audit trail
src/lib/ai/           provider-neutral AI layer (Anthropic, OpenAI)
src/proxy.ts          auth gate + cross-site request block
src/app/              pages and API routes
tests/                unit, integration, e2e
```

## Security notes
- One owner password (`AVI_OWNER_PASSWORD`) and a signed, httpOnly, 14-day session cookie. No user table.
- All database access is server-side through `DATABASE_URL`. Row Level Security is switched on with no policies, so Supabase's public API keys cannot read the tables.
- API keys are read only on the server; nothing secret is sent to the browser.
- Uploads: `.xlsx` only, 10 MB cap, zip signature check, uncompressed-size cap, formulas never evaluated, unsafe URLs dropped.
- CSV export neutralises spreadsheet-formula injection. AI prompts treat idea text as untrusted data.
