# Tortracker

A private, mobile-friendly grocery notebook for Toronto. Capture receipts and shelf labels, review extracted drafts, track confirmed spending, and compare recorded prices with valid flyer offers.

The [PRD](tortracker-prd.md) defines P0. Next.js serves the three main screens; a separate Python worker processes a durable Supabase Postgres job queue. Supabase provides authentication, private storage and user-owned records. Maps use MapLibre with OpenFreeMap tiles.

## Run locally

Requirements: Node 22+, Python 3.12+, Docker, and an extraction-provider key.

    npm ci
    python -m venv .venv
    .venv/bin/pip install -r requirements.txt
    npx supabase start -x studio,realtime,edge-runtime,logflare,vector,imgproxy,supavisor
    npm run local:setup
    node scripts/seed-local.mjs

Local setup writes an ignored, private .env.local file using the local stack's keys. It refuses hosted Supabase URLs. Seed accounts are for local use only: sign in as isaac@example.test with password Tortracker-local-2026!.

Add OPENAI_API_KEY to .env.local, then run these in separate terminals:

    npm run dev
    .venv/bin/python -m worker.main

Open http://localhost:3000. JPG, PNG, WebP and PDF uploads up to 10 MB are supported. A photo uploads to a private bucket before its job is committed. Once uploaded, processing continues independently of the browser.

## End-to-end tests

    npx playwright install --with-deps chromium
    npm run typecheck
    npm run build
    E2E_WEB_COMMAND='npm start' npm run test:e2e

Playwright runs desktop and mobile journeys against the actual Next.js app, Python worker, Supabase auth, Postgres, storage, and queue. The external extraction provider is a deterministic local HTTP fixture; map-style responses are also fixtures. App routes, database writes, job execution and authentication are not mocked. Test setup is restricted to loopback Supabase and provisions separate accounts. There is no unit-test suite.

Coverage includes sign-in, browser closure during processing, financial reconciliation and decimal arithmetic, draft exclusion, confirmation/corrections, spending and CSV, shelf labels, unknown sizes, saved item mappings, manual online/in-store prices, conversions, flyer expiry and atomic validation, mapped branches, worker termination/recovery, stale-job rejection, and cross-account API/database/storage isolation.

CI builds the production app and runs the same suite on every PR and main-branch push. Mark the End-to-end acceptance / notebook check as required in GitHub branch settings.

## Data and failure behavior

Money uses Postgres NUMERIC, Python Decimal and decimal.js. API read views cast numeric columns to strings. Unknown values stay null. Unit conversions happen in code; a comparable price is shown only when size and unit are known.

Confirmation and correction happen in one database transaction. Receipt lines, remembered mappings and derived observations update together. Drafts and shelf labels are excluded from spending. Item amounts already include known item discounts; receipt-wide discounts and fees are reconciled separately.

Jobs are claimed using FOR UPDATE SKIP LOCKED and expiring lease tokens. The worker renews its lease while extracting. A crashed process can be replaced without losing its job. Results require the current lease and receipt version. Three failures expose a retry action. Explicit retry creates another attempt on the same receipt.

User records are protected by RLS. Writes use guarded database functions; worker-only functions require the Postgres service_role role. The web service uses user sessions and a publishable API key (sb_publishable_...). The worker uses a secret API key (sb_secret_...), which grants elevated service_role access and bypasses RLS. Keep that secret out of the web service and browser. Storage is private, and original files are shown through short-lived signed URLs.

Offers keep official source links, conditions, applicable branches and inclusive validity dates. Current-offer filtering uses America/Toronto. Recorded observations remain historical evidence. Unknown branches are excluded from the map.

## Deploy to the existing projects

Railway project: tortracker. Supabase project: ptnrecrrdvkmyemcqrdk.

1.  Link the Supabase CLI to the existing project, review migrations, then apply them:

        npx supabase link --project-ref ptnrecrrdvkmyemcqrdk
        npx supabase db push

    The migration does not seed branch records on a hosted project. Import the reviewed contents of supabase/seed.sql separately after verifying the branch shortlist and locations. Disable public signup in the project's Auth settings and provision Isaac's account through the dashboard.

2.  Add two services in the same Railway project, both using this repository. Set the web service's Railway config path to deploy/web.railway.toml and the worker's to deploy/worker.railway.toml.

3.  On the web service configure:
    - NEXT_PUBLIC_SUPABASE_URL=https://ptnrecrrdvkmyemcqrdk.supabase.co
    - NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY from the project's API Keys settings (sb_publishable_...)
    - APP_URL to the web service's HTTPS origin
    - Optional NEXT_PUBLIC_MAP_STYLE_URL for another licensed tile provider

    Railway must make the NEXT_PUBLIC variables available at build time. Only public configuration is baked into the browser bundle.

4.  On the worker configure NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY from the project's API Keys settings (sb_secret_...), and OPENAI_API_KEY. Optional settings are listed in .env.example. Give the worker no public domain. Keep service credentials out of the web service and Git.

5.  Set Supabase's Auth site URL to the deployed web origin, provision the account, and run the staging acceptance checks below.

No hosted project is modified by local setup or the test suite. Access credentials must be supplied through the deployment environment to apply migrations and deploy.

## Live release gates

The automated suite is not a measurement of extraction quality on real receipts. Before P0 release:

- Evaluate 20 real receipts with the configured live extraction provider; at least 16 need no financial correction.
- Measure median active review time; it must be below 20 seconds. Time spent waiting for extraction does not count.
- Verify the initial 5–8 branch locations and official source pages, and refine the 20 starter comparison groups for Isaac's actual items.
- On staging, confirm browser-independent processing, corrected dashboard totals, no duplicate purchases after retries, and account isolation.
- Compare one item across two stores with an in-store observation, online observation and valid flyer offer. Verify source links, conversions, expiry and conditions.

Automatic retailer imports, public signup, price-history views, watched items and alerts remain outside P0.
