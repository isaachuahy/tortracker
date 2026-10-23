# Tortracker

A private, mobile-friendly grocery dashboard for Toronto. Capture receipts and shelf labels, import Gmail receipts and authorized flyer feeds, review extracted drafts, and compare recorded unit costs with valid sales and PC Optimum offers.

The [PRD](tortracker-prd.md) records the original P0 and dashboard extension. Next.js serves Dashboard, Capture, Spending, Prices, and Sources. A Python worker processes a durable Supabase Postgres job queue; an optional separate Gmail worker imports receipts. Supabase provides authentication, private storage and user-owned records. Maps use MapLibre with OpenFreeMap tiles.

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
    npm run test:imports
    .venv/bin/python -m unittest worker.test_email_import -v
    npm run build
    E2E_WEB_COMMAND='npm start' npm run test:e2e

Playwright runs desktop and mobile journeys against the actual Next.js app, Python worker, Supabase auth, Postgres, storage, and queue. The external extraction provider is a deterministic local HTTP fixture; map-style responses are also fixtures. App routes, database writes, job execution and authentication are not mocked. Test setup is restricted to loopback Supabase and provisions separate accounts. Focused Node and Python tests also cover sale boundaries, feed validation, and email import behavior. Node 22.18+ or Node 24 is required for the TypeScript import tests.

Coverage includes sign-in, browser closure during processing, financial reconciliation and decimal arithmetic, draft exclusion, confirmation/corrections, spending and CSV, shelf labels, unknown sizes, saved item mappings, manual online/in-store prices, conversions, flyer expiry and atomic validation, mapped branches, worker termination/recovery, stale-job rejection, and cross-account API/database/storage isolation.

CI builds the production app and runs the same suite on every PR and main-branch push. Mark the End-to-end acceptance / notebook check as required in GitHub branch settings.

## Data and failure behavior

Money uses Postgres NUMERIC, Python Decimal and decimal.js. API read views cast numeric columns to strings. Unknown values stay null. Unit conversions happen in code; a comparable price is shown only when size and unit are known.

Confirmation and correction happen in one database transaction. Receipt lines, remembered mappings and derived observations update together. Drafts and shelf labels are excluded from spending. Item amounts already include known item discounts; receipt-wide discounts and fees are reconciled separately.

Jobs are claimed using FOR UPDATE SKIP LOCKED and expiring lease tokens. The worker renews its lease while extracting. A crashed process can be replaced without losing its job. Results require the current lease and receipt version. Three failures expose a retry action. Explicit retry creates another attempt on the same receipt.

User records are protected by RLS. Writes use guarded database functions; worker-only functions require the Postgres service_role role. The web service uses user sessions and a publishable API key (sb_publishable_...). The worker uses a secret API key (sb_secret_...), which grants elevated service_role access and bypasses RLS. Keep that secret out of the web service and browser. Storage is private, and original files are shown through short-lived signed URLs.

Offers keep official source links, conditions, applicable branches and inclusive validity dates. Current-offer filtering uses America/Toronto. Recorded observations remain historical evidence. Unknown branches are excluded from the map.

Dashboard shows one row per grocery item, with its latest observed package price, normalized cost per kg/L/each, store, date, and comparable active offer. The `item_unit_costs` database view exposes the same normalized data as exact decimal strings. `items` identifies products, `observations` preserves price history, and `offers` holds separate sale records. Unknown package sizes never become invented unit costs.

Offers can additionally specify `starts_at` and `ends_at` with explicit timezone offsets; exact intervals include the start and exclude the end. Date-only imports remain inclusive of the final Toronto day. PC Optimum points and purchase conditions are separate from cash prices. Stable source IDs make repeated imports update the existing sale, atomically and within the owner's account.

## Import sources

Use **Sources** to save a Canadian postal code, import CSV/JSON offers, refresh a configured flyer feed, and inspect email-import history. A saved owner preference takes precedence over the server’s optional `FLYER_POSTAL_CODE` fallback. Manual offer imports and feed refreshes share validation, exact item/branch matching, and retry-safe source identities. The downloadable CSV template is illustrative, not a real flyer.

- [Gmail setup and behavior](docs/email-import.md): configure a read-only OAuth grant on a separate worker, set its owner UUID and expected mailbox, then run `python -m worker.email_import --once` before enabling polling. Receipt emails become reviewable drafts. ChatGPT's Gmail connection does not automatically authorize a deployed app.
- [Authorized flyer feeds](docs/flyer-feeds.md): configure `FLYER_FEED_URL`, optional token, and postal-code substitution on the web server. Missing configuration is shown honestly; no provider is marked connected by default.
- PC Optimum item offers can be imported as CSV/JSON with `points`, `loyalty_program`, sale bounds, and conditions. Its receipt emails use Gmail intake. Direct PC Optimum account synchronization and arbitrary retailer scraping are not implemented.

The importer stores only private provenance and status in `email_imports` and `email_import_sources`; OAuth credentials stay in worker environment variables. Imported emails and extracted text are treated as untrusted evidence. Email is never sent, deleted, labeled, or marked read.

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

6.  To enable Gmail intake, add a third private Railway service using `deploy/email-import.railway.toml` and configure the variables listed in the Gmail guide. Keep its domain disabled. The existing extraction worker still processes the queued receipts. Set `FLYER_POSTAL_CODE` on the web service for the default area, or save it through Sources.

No hosted project is modified by local setup or the test suite. Access credentials must be supplied through the deployment environment to apply migrations and deploy.

## Live release gates

The automated suite is not a measurement of extraction quality on real receipts. Before P0 release:

- Evaluate 20 real receipts with the configured live extraction provider; at least 16 need no financial correction.
- Measure median active review time; it must be below 20 seconds. Time spent waiting for extraction does not count.
- Verify the initial 5–8 branch locations and official source pages, and refine the 20 starter comparison groups for Isaac's actual items.
- On staging, confirm browser-independent processing, corrected dashboard totals, no duplicate purchases after retries, and account isolation.
- Compare one item across two stores with an in-store observation, online observation and valid flyer offer. Verify source links, conversions, expiry and conditions.

Live Gmail authorization, a reachable authorized flyer feed, and production deployment require configured provider and hosting credentials. Fixture tests do not establish those connections or measure real extraction quality. Public signup, account-only PC Optimum imports, watched items and alerts remain outside this extension.
