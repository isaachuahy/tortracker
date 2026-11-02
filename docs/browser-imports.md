# Browser-assisted flyers and PC Optimum

Browser access can prepare an import when a retailer has no supported feed. It does not turn a browser session into an unattended API. Use a user-directed browser agent with a saved profile, such as TinyFish, and preserve the source evidence in the user's selected tracker. Credentials and cookies belong in that browser provider, never in this repository or an import file.

## Choose the destination before importing

Honor the user's stated destination and any established choice in the session. When the user selects Notion, use the connected Notion databases as the destination; a deployed Tortracker app or app session is not required. Discover their schema through the Notion connector before preparing writes. Use the legacy web-app path when the user selects that app. Do not silently write to both, create replacement databases, or imply that the app and Notion synchronize.

| Source evidence | Notion destination role, discovered from its schema | Legacy web-app destination | Required distinction |
| --- | --- | --- | --- |
| Local flyer with a stated item cash price | Sales or discounts related to the catalog item | **Sources → Import flyer or points offers** | Exact item, branch, package size and sale dates; a flyer price is not a price paid. |
| PC personalized points, multiplier, category or basket reward | Loyalty offers | **PC Optimum → Review a browser-agent import** | Rewards are conditions, not cash prices. Unknown dates and reward amounts stay empty. |
| PC earned/redeemed/adjusted points | Points ledger | **PC Optimum → Review a browser-agent import** | Signed points transactions; a partial ledger is not a current balance. |
| Itemized purchase receipt | Receipts and related purchase-price observations | **Capture**, or the [Gmail worker](email-import.md) | Review uncertain receipt fields before counting spending. A points transaction is not a receipt. |

These are logical roles, not assumed database or property names. Existing item/catalog records provide the relation targets. Preserve the distinctions even if the user's schema represents them with different tables or explicit record-type fields.

### Notion connector workflow

1. Resolve the user-selected dashboard and its existing databases using the connector. Read each relevant data source's properties and relation targets. Record the actual data source IDs, property IDs/names, types and select options in private working state. Do not copy personal destination URLs, email addresses, postal codes or browser-profile identifiers into this repository.
2. Build a typed mapping from evidence to those properties: titles and text to title/rich-text fields, source links to URL fields, dates/times to date fields, and existing option values to select/status fields. Resolve each item, receipt and other relation by querying the intended relation target, then use the returned page ID in a relation value. Matching display text is not a substitute for a typed relation. Unknown or ambiguous matches remain unresolved; do not invent IDs or connect records from a different database.
3. Preserve source money and quantities as exact decimal strings in raw-value text properties or the record body. Numeric properties may support views and calculations, but must not replace the original amount, currency and unit evidence. Keep package price, normalized unit cost, regular/reference price, discount and amount actually paid distinct. Store flyer/sale evidence separately from confirmed purchase observations, with provenance and observation time. Missing values stay empty, not zero; points never substitute for cash price.
4. Give each record a stable **Source ID** in the discovered text property, namespaced by provider, record kind and, when needed, a non-sensitive account alias or region. Prefer the source's own stable ID. Otherwise derive an ID from immutable evidence, not list order, observation time or a changing price. Before creating any record, query that exact Source ID in its target data source. Update one match only when the new observation is not older; create when no match exists. Multiple matches require reconciliation rather than another insert.
5. Import sequentially in dependency order: resolve catalog and receipt records before writing records that relate to them. Notion does not provide a transactional batch or a unique constraint on Source ID, so prelookup is an idempotence strategy, not a concurrency guarantee. Avoid parallel writers to the same source identities. Keep a private per-record progress log with the returned page ID and completed relations. After a timeout or uncertain create result, re-query Source ID before retrying. Resume partial work from verified records; do not restart the batch with blind creates.
6. Read back saved properties and relations through the connector. Report created, updated, unchanged, unresolved and failed records separately. A partially completed import must be reported as partial, with recoverable remaining work. Do not claim an atomic import, successful app synchronization or an unattended browser connection from a successful Notion write.

The CSV and JSON contracts below describe the legacy application and may serve as intermediate evidence formats. They are not Notion API payloads; connector writes must use the destination's discovered property schema. Missing schema fields should be handled within the user's authorized scope, with unmapped evidence retained in an appropriate text field or record body and any remaining gap reported.

## Flyer workflow

1. Read the user's saved location and existing item/store mappings from the selected destination or session. Choose a retailer's official page or an authorized feed. Select and visibly verify the branch before extracting prices. A location parameter in a URL is not sufficient evidence by itself.
2. Open the current specials list or flyer. Record its displayed start/end dates, store name/address and original URL. If a PDF link and page disagree, stop and resolve the dates. Do not substitute another region.
3. Extract a bounded selection of requested groceries. Preserve names, sizes, multibuy requirements, loyalty requirements, limits and exclusions. Convert a package size only when its total is unambiguous. Leave unknown sizes blank. Do not substitute points for a missing cash price or infer a regular price.
4. Match exact existing item and branch identities. Keep unresolved products for mapping instead of inventing IDs. For Notion, use the typed relations and sequential, recoverable workflow above. For the web app, prepare the [documented CSV/JSON](flyer-feeds.md) and save through the signed-in Sources screen; its atomic importer rejects the whole batch if a mapping or row is invalid.

Farm Boy's [weekly flyer](https://www.farmboy.ca/weekly-flyer-specials/) exposes a store picker and **View Specials List**, including prices, package sizes and dates. Its [Front and Bathurst store](https://www.farmboy.ca/stores/front-and-bathurst/) is a downtown Toronto candidate; the selected branch must still be verified in each run. Follow the retailer's [personal-use terms](https://www.farmboy.ca/terms-conditions/); do not bulk crawl or redistribute a retailer database.

Flipp's [terms](https://corp.flipp.com/terms-of-use/) restrict capturing content and incorporating it in databases. Use an authorized partner feed or link to Flipp; this project does not bypass those restrictions with an unofficial endpoint or browser scraper.

## PC Optimum browser connection

1. List browser profiles and use one recorded as signed in to PC Optimum. If none is signed in, offer a secure profile setup link so the user can authenticate personally, including MFA. Do not request passwords, tokens or session cookies in chat. A connected browser tool alone does not mean the account is signed in.
2. Confirm the intended account without copying unnecessary identity details. Read personalized offers and their expanded terms, then the account's points/transaction history. Keep each request bounded. Stop for expired authentication, CAPTCHA, a site restriction or missing information; do not guess.
3. Signing in or viewing personalized offers can automatically load offers, according to [the retailer's help](https://www.nofrills.ca/en/help/pc-optimum/when-do-i-receive-personalized-offers-and-how-do-i-load-my-personalized-offers). Disclose this normal account effect before browsing. Do not intentionally save offers for next week, redeem points, submit claims or change account settings unless requested.
4. Preserve the exact terms and the observation time. Use the site's stable offer or transaction ID when exposed. Otherwise maintain a stable local mapping based on immutable evidence; identical-looking transactions need distinct IDs, and uncertain duplicates require review. Do not use list position or observation time as an identity. Prefix IDs with a stable non-sensitive account alias when tracking multiple accounts.
5. Prepare reviewable records and save to the selected destination when authorized. For Notion, map rewards and points history to their discovered data sources and use the sequential workflow above. For the web app, prepare the JSON envelope below and save through the authenticated PC Optimum screen. That app importer has no access to your browser profile; it accepts at most 200 total records, writes both tables atomically, ignores older observations for an existing source ID, and retains records missing from later snapshots. Those atomicity guarantees do not apply to Notion.

The [official points FAQ](https://www.esso.ca/en-ca/pc-optimum-faq) describes earned, redeemed, adjusted points and balances. It does not establish itemized grocery receipt access. Completed PC Express orders may have receipts in [retailer order history](https://www.loblaws.ca/en/help/after-delivery-pickup/can-i-get-a-copy-of-my-receipt). Import those actual receipts separately; avoid counting an emailed receipt and the same order twice. No official PC Optimum public API or export format is assumed here.

## Legacy web-app loyalty JSON contract

The following is an illustrative shape, not an actual offer or transaction. The UI's example is never saved automatically. Decimal amounts and multipliers are strings. Points are signed integers in transactions and nonnegative integers in offers. All timestamps require a timezone offset. Date-only validity includes the final day in Toronto; an exact end time is exclusive. Either bound can be unknown: preserve an expiry-only offer without inventing a start. A known end can prove expiration and a known future start can prove upcoming status; both bounds are needed to prove current validity. If either exact timestamp is present, use only the exact-time representation; calendar bounds do not fill missing exact bounds.

```json
{
  "offers": [{
    "source_id": "example-account:replace-with-offer-id",
    "title": "Example basket reward — replace from source",
    "scope": "basket",
    "points": 1000,
    "points_multiplier": null,
    "minimum_spend": "20.00",
    "minimum_quantity": null,
    "item_id": null,
    "starts_at": null,
    "ends_at": null,
    "valid_from": null,
    "valid_to": null,
    "terms": "Illustrative only. Copy all actual requirements and exclusions.",
    "source_url": "https://www.pcoptimum.ca/",
    "activation_state": "unknown",
    "observed_at": "2026-10-23T12:00:00-04:00"
  }],
  "transactions": [{
    "source_id": "example-account:replace-with-transaction-id",
    "occurred_at": null,
    "observed_at": "2026-10-23T12:00:00-04:00",
    "points_delta": -10000,
    "type": "redeemed",
    "merchant": null,
    "receipt_id": null,
    "source_url": "https://www.pcoptimum.ca/",
    "description": "Illustrative only. Copy the actual transaction description."
  }]
}
```

Offer `scope` is `item`, `category`, `basket` or `unknown`; activation is `active`, `available` or `unknown`. An active date range does not prove an offer is loaded. Transaction `type` is `earned`, `redeemed`, `adjustment` or `unknown`; earned deltas cannot be negative and redeemed deltas cannot be positive. Optional linked item/receipt UUIDs must belong to the signed-in owner. Leave them null when unverified. Do not fabricate a time for a transaction whose date is not known precisely; retain the displayed date in its description.

`GET /api/loyalty` returns private owner data. Same-origin authenticated `POST /api/loyalty` accepts the envelope and returns the number of offers and transactions inserted or updated. Its strict schema rejects cash-price fields, unknown keys, inconsistent bounds and duplicate source IDs in one batch. Database ownership checks and uniqueness constraints also apply to direct RPC requests.

The reusable [browser import skill](../.agents/skills/tortracker-browser-import/SKILL.md) guides an agent through either destination. Source account authentication, access to the chosen destination and a successful live source run are separate prerequisites; local fixture tests do not establish any of them. Notion imports require a working connector with access to the selected data sources. Legacy app imports require an authenticated deployed app session. Neither path automatically synchronizes the other destination or schedules future runs.
