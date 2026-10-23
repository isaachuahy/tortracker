# Authorized flyer feeds

The Sources page can import a provider's normalized flyer feed into the signed-in user's sales table. It does not scrape grocery sites or sign in to PC Optimum. Configure a feed that you are authorized to access.

Set these environment variables on the application server:

| Variable | Purpose |
| --- | --- |
| `FLYER_FEED_URL` | Public HTTPS JSON or CSV endpoint. Use the literal `{postal_code}` anywhere the provider expects a location value. |
| `FLYER_FEED_TOKEN` | Optional bearer token. Stored and used only on the server. |
| `FLYER_POSTAL_CODE` | Optional fallback Canadian postal code when the user has not saved one in Sources. |

The user's saved postal code takes precedence and is normalized, for example `m5v 1a1` becomes `M5V1A1`. A template containing `{postal_code}` requires a saved or fallback code. Configure regional semantics with the provider; the tracker does not assume an arbitrary API's postal-code parameter.

`GET /api/imports/flyers` requires sign-in and returns only `{ "configured": true }` or `{ "configured": false }`. It does not return the feed URL or token, or test provider availability. A same-origin, authenticated `POST /api/imports/flyers` takes no parameters and returns `{ "count": 12 }` after an atomic import. `count` is the number of offers processed, including existing offers updated by the feed. No URL from the browser is used.

## Format

CSV must contain these exact headers. JSON may be an array of records or `{ "offers": [...] }` with the same field names. Prices and package sizes must be decimal strings in JSON; at most four decimal places are accepted.

```csv
item_name,store_branch,price,package_size,unit,valid_from,valid_to,source_url,channel,conditions
Milk 2%,Local Grocer Downtown,4.99,2,l,2026-10-22,2026-10-28,https://example.com/flyer,in-store,"Limit 2, while supplies last"
```

This is an illustrative schema example, not a real price or store. Replace its item and branch with exact, unique names already present in the tracker. Unknown or ambiguous names reject the entire import with the row number; the importer never guesses a product or location. A branch name must be unique, even if a retailer has several branches.

| Field | Rule |
| --- | --- |
| `item_name`, `store_branch` | Exact existing names, up to 160 characters. |
| `price` | Nonnegative package price, up to eight integer and four fractional digits. |
| `regular_price` | Optional nonnegative reference package price using the same decimal format. Preserved from the provider; never inferred from discounts or points. |
| `package_size`, `unit` | Both present or both blank. Size must be positive. Units: `g`, `kg`, `ml`, `l`, `count`. |
| `valid_from`, `valid_to` | Inclusive calendar dates, `YYYY-MM-DD`; end on or after start. |
| `source_url` | HTTP(S) source link, at most 2,048 characters. Stored as provenance, never fetched. |
| `channel` | `in-store`, `online pickup`, `online delivery`, or `unspecified`. |
| `conditions` | May be empty; maximum 1,000 characters. Preserve purchase limits and multibuy rules. |
| `starts_at`, `ends_at` | Optional paired ISO timestamps with `Z` or a UTC offset. The interval includes the start and excludes the end; end must be later. |
| `points` | Optional nonnegative integer, maximum 2,147,483,647; defaults to zero. |
| `loyalty_program` | Blank or `PC Optimum`; required when points are greater than zero. Points are separate from cash price. Selecting PC Optimum for a manual upload supplies this value when omitted. |
| `source_id` | Optional unique provider offer-and-branch ID, at most 250 characters. |

Repeated imports upsert the same user's offer rather than adding duplicates. Manual uploads namespace IDs by the selected provider, source URL origin, and store branch, so independent retailers cannot overwrite each other's offers. Each configured endpoint and postal code has a stable hashed provider namespace. When `source_id` is absent, a stable ID is derived from the item, branch, package, dates/times, channel, source link, and loyalty program. Price, regular price, points, and conditions may change without changing that identity. A changed sale period is a new offer. Use explicit stable IDs if the provider updates those identity fields. Changing the configured endpoint or postal code creates a separate source namespace. Existing offers absent from a later feed are retained and expire according to their recorded interval.

Exact duplicate rows within a response are coalesced. Conflicting repeated IDs reject the import. All rows are validated and mapped before the authenticated `import_offers` database transaction, whose ownership and uniqueness constraints enforce isolation and idempotency.

## Limits and failures

Downloads are limited to 2 MiB, 500 offers, 15 seconds total, and three redirects. HTTPS on port 443 is required. Redirects must stay on the original origin. Every resolved address is checked for private/special ranges, and connections are pinned to a validated public address. Tokens are not forwarded to another origin. Compressed responses are rejected; the client requests an uncompressed body. Provider response bodies and credentials are never returned in error messages.

Missing configuration returns HTTP 503; malformed rows, unknown names, and missing postal codes return 422; provider/network failures return 502; timeouts return 504. These errors do not report success or import partial rows. A configured status alone does not mean that a provider connection has been tested. Live importing requires a reachable, configured feed.

Run the pure validation tests with Node 22.18+ (Node 24 also works):

```sh
node --test tests/flyer-feed.test.mjs
```
