# Browser-assisted flyers and PC Optimum

Browser access can prepare an import when a retailer has no supported feed. It does not turn a browser session into an unattended API. Use a user-directed browser agent with a saved profile, such as TinyFish, and preserve the source evidence for review in Tortracker. Credentials and cookies belong in that browser provider, never in this repository or an import file.

## Choose the correct destination

| Source evidence | Destination | Required distinction |
| --- | --- | --- |
| Local flyer with a stated item cash price | **Sources → Import flyer or points offers** | Exact item, branch, package size and sale dates; see [feed format](flyer-feeds.md). |
| PC personalized points, multiplier, category or basket reward | **PC Optimum → Review a browser-agent import** | Rewards are conditions, not cash prices. Unknown dates and reward amounts stay null. |
| PC earned/redeemed/adjusted points | **PC Optimum → Review a browser-agent import** | Signed points transactions; a partial ledger is not a current balance. |
| Itemized purchase receipt | **Capture**, or the [Gmail worker](email-import.md) | Review and confirm the receipt before counting spending. A points transaction is not a receipt. |

## Flyer workflow

1. Read the user's saved location and existing item/store names. Choose a retailer's official page or an authorized feed. Select and visibly verify the branch before extracting prices. A location parameter in a URL is not sufficient evidence by itself.
2. Open the current specials list or flyer. Record its displayed start/end dates, store name/address and original URL. If a PDF link and page disagree, stop and resolve the dates. Do not substitute another region.
3. Extract a bounded selection of requested groceries. Preserve names, sizes, multibuy requirements, loyalty requirements, limits and exclusions. Convert a package size only when its total is unambiguous. Leave unknown sizes blank. Do not substitute points for a missing cash price or infer a regular price.
4. Match exact existing item and branch names. Show unresolved products for mapping instead of inventing IDs. Prepare the documented CSV/JSON and save through the signed-in Sources screen. The atomic importer rejects the whole batch if a mapping or row is invalid.

Farm Boy's [weekly flyer](https://www.farmboy.ca/weekly-flyer-specials/) exposes a store picker and **View Specials List**, including prices, package sizes and dates. Its [Front and Bathurst store](https://www.farmboy.ca/stores/front-and-bathurst/) is a downtown Toronto candidate; the selected branch must still be verified in each run. Follow the retailer's [personal-use terms](https://www.farmboy.ca/terms-conditions/); do not bulk crawl or redistribute a retailer database.

Flipp's [terms](https://corp.flipp.com/terms-of-use/) restrict capturing content and incorporating it in databases. Use an authorized partner feed or link to Flipp; this project does not bypass those restrictions with an unofficial endpoint or browser scraper.

## PC Optimum browser connection

1. List browser profiles and use one recorded as signed in to PC Optimum. If none is signed in, offer a secure profile setup link so the user can authenticate personally, including MFA. Do not request passwords, tokens or session cookies in chat. A connected browser tool alone does not mean the account is signed in.
2. Confirm the intended account without copying unnecessary identity details. Read personalized offers and their expanded terms, then the account's points/transaction history. Keep each request bounded. Stop for expired authentication, CAPTCHA, a site restriction or missing information; do not guess.
3. Signing in or viewing personalized offers can automatically load offers, according to [the retailer's help](https://www.nofrills.ca/en/help/pc-optimum/when-do-i-receive-personalized-offers-and-how-do-i-load-my-personalized-offers). Disclose this normal account effect before browsing. Do not intentionally save offers for next week, redeem points, submit claims or change account settings unless requested.
4. Preserve the exact terms and the observation time. Use the site's stable offer or transaction ID when exposed. Otherwise maintain a stable local mapping based on immutable evidence; identical-looking transactions need distinct IDs, and uncertain duplicates require review. Do not use list position or observation time as an identity. Prefix IDs with a stable non-sensitive account alias when tracking multiple accounts.
5. Prepare the JSON envelope below, review it, then save it through the authenticated PC Optimum screen. The importer has no access to your browser profile. It accepts at most 200 total records, writes both tables atomically, and ignores older observations for an existing source ID. It retains records missing from later snapshots.

The [official points FAQ](https://www.esso.ca/en-ca/pc-optimum-faq) describes earned, redeemed, adjusted points and balances. It does not establish itemized grocery receipt access. Completed PC Express orders may have receipts in [retailer order history](https://www.loblaws.ca/en/help/after-delivery-pickup/can-i-get-a-copy-of-my-receipt). Import those actual receipts separately; avoid counting an emailed receipt and the same order twice. No official PC Optimum public API or export format is assumed here.

## Loyalty JSON contract

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

The reusable [browser import skill](../.agents/skills/tortracker-browser-import/SKILL.md) guides an agent through this workflow. Account authentication, a deployed Tortracker session and a successful live source run are separate prerequisites; local fixture tests do not establish any of them.
