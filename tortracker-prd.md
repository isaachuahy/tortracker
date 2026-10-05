# Grocery Tracker — Product Requirements

**Status:** Draft. **Release:** P0.

## 1. Purpose and scope

Record grocery purchases with little manual work. Compare recorded prices and valid offers at nearby stores.

Start with Isaac as the only user. Build a mobile-friendly web app with private accounts and user-owned records.

Cover King West and the Entertainment District. Include College/Carlton–Yonge as a second shopping area.

Start with 5–8 selected stores and 15–25 frequently purchased items. Do not promise complete store coverage or current stock information.

## 2. P0 requirements

| ID | Feature | Requirement |
|---|---|---|
| R1 | Receipt capture | Accept receipt photos and uploaded files. Extract an editable draft. Continue processing after the browser closes. |
| R2 | Receipt review | Check line amounts against receipt totals. Show uncertain fields and unexplained differences. Let the user correct and confirm the receipt. Preserve corrections. Reuse confirmed item names. |
| R3 | Spending dashboard | Show spending by month, store, and category. Provide item search and CSV export. Use confirmed receipts only. |
| R4 | Price capture | Create price observations from confirmed receipts. Accept shelf-label photos and manual entries for in-store and online prices. |
| R5 | Price search | Search by item. Show results in a list and on a map. Show store, price, comparable unit price, date, source, channel, and conditions. Open this search from a receipt item. |
| R6 | Flyer offers | Accept permitted retailer data through manual entry or CSV import. Link each offer to its official source. Record applicable stores, validity dates, and purchase conditions. |

Use three main screens: **Capture**, **Spending**, and **Prices**.

## 3. Data rules

Record store, branch, date, original item text, quantity, package size, discounts, subtotal, tax, and receipt total.

Keep these values separate:

| Value | Definition |
|---|---|
| Purchase-unit price | The price for one purchased package or counted item. |
| Line amount paid | The line amount after known item discounts. |
| Comparable unit price | The price per standard weight, volume, or count. |

Keep purchases, price observations, and offers as separate records. Identify each price as in-store, online pickup, online delivery, or unspecified.

Keep missing values unknown. Use exact decimal arithmetic for money. Calculate unit conversions in code. Record regular and advertised sale prices only when the source provides them. Do not infer missing package sizes.

Compare items only within a defined comparison group. Keep historical observations separate from valid offers. Exclude expired offers from current results. Map a price only when its store branch is known.

Retain dated evidence where source terms permit. Update derived prices when receipt corrections change their values.

## 4. Architecture

Use one repository and one Railway project.

| Component | Responsibility |
|---|---|
| Next.js web service on Railway | Provide screens, authenticated requests, edits, and job submission. |
| Python worker on Railway | Extract receipts, resolve item names, check amounts, and import prices. |
| Supabase | Provide Postgres, authentication, private file storage, and a durable job queue. |
| MapLibre and a tile provider | Display selected stores and price results. |

Use one extraction provider. Use saved item mappings before a classifier. Keep Jev optional and replaceable.

Keep jobs separate from web requests. Make retries safe against duplicate records. Show failed jobs with a retry action.

Keep receipt files private. Enforce record ownership. Keep service credentials on the server. Do not require inbox access or background location access.

## 5. Release checks

Test with 20 real receipts. At least 16 must need no financial correction. Median active review time must be below 20 seconds.

Verify that corrected receipts produce correct dashboard totals. Verify that retries do not duplicate purchases.

Compare one item across two stores. Include an in-store observation, an online observation, and a valid flyer offer in the test data.

Verify source links, unit conversions, offer expiry, and account isolation. Treat these as release targets, not measured results.

## 6. Build order and later work

Build receipt capture and review first. Add the dashboard next. Then add price capture, flyer import, and search.

P1 adds price-history views, automatic source imports, watched items, and sale alerts. Evaluate Open Prices before integration.

Exclude public signup, bank connections, retailer-account imports, pantry management, and route optimization from P0.
