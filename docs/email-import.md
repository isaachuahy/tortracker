# Gmail receipt imports

Tortracker can pull grocery receipts from Gmail into its existing private capture
and review queue. This is a separate worker process; it does not block receipt
extraction. Imported drafts must be reviewed and confirmed before they affect
spending or unit prices.

No Gmail connection is provisioned by source code or by having Gmail connected to
ChatGPT. A deployed Railway worker needs its own Google OAuth client and an
offline refresh token authorized by the mailbox owner for exactly this scope:

    https://www.googleapis.com/auth/gmail.readonly

Configure the Google consent screen and obtain offline authorization using the
[Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server#offline).
Use a supported private/internal configuration or complete Google's required
verification for the intended audience. External consent screens left in Testing
can issue short-lived refresh tokens. No password, app password, or token belongs
in a browser form, committed file, log, or chat message.

## Worker configuration

Apply `202610230002_email_import.sql` after the core migration. Configure these
variables only on the Gmail import worker:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | The existing Supabase project's URL. |
| `SUPABASE_SECRET_KEY` | Worker-only elevated key; never configure it on the web service. |
| `GMAIL_CLIENT_ID` | Google OAuth client ID. |
| `GMAIL_CLIENT_SECRET` | OAuth client secret. |
| `GMAIL_REFRESH_TOKEN` | Offline token from the mailbox owner's read-only consent. |
| `GMAIL_IMPORT_USER_ID` | Existing Supabase Auth user UUID that owns imported receipts. |
| `GMAIL_EXPECTED_EMAIL` | Expected Gmail address; set this to reject the wrong mailbox before reading messages. |
| `GMAIL_IMPORT_QUERY` | Optional Gmail search; default restricts recent grocery retailer receipt/order subjects. |
| `GMAIL_IMPORT_PAGE_SIZE` | Messages per pass, 1–100; default 25. |
| `GMAIL_IMPORT_INTERVAL_SECONDS` | Poll interval, 60–86400 seconds; default 900. |

Run a single bounded pass:

    python -m worker.email_import --once

Run the separate polling service:

    python -m worker.email_import

Use the same Python dependencies as the existing extraction worker. The ordinary
`python -m worker.main` service still needs the configured extraction provider
key to process queued documents. The email importer itself does not need that
provider key.

The default query covers the past 90 days, excludes Spam and Trash, and selects
receipt, invoice, and order-confirmation subjects from configured Canadian
grocery sender domains. Inspect and adjust `GMAIL_IMPORT_QUERY` for the actual
retailers and senders in the mailbox. PC Optimum **receipt emails** can enter the
same queue; personalized offer emails and account-only transaction pages are not
automatically converted into purchases.

## Sync and review behavior

- Each pass reads one bounded Gmail page. Pagination progress is persisted; after
  the last page the next pass checks the newest results again. Changing the query
  starts a fresh scan. A temporary list failure keeps its cursor for retry;
  an expired Gmail page token restarts the search on the next pass.
- A source status of `partial` means more pages remain. `ready` means that pass
  completed; it is not a promise that every store emails complete receipts. Use
  the last-success time to assess freshness. `error` preserves saved receipts and
  exposes a safe diagnostic without provider responses or message contents.
- PDF receipts and explicitly named receipt images are preferred over the email
  body so a summary and its attached receipt do not become duplicate purchases.
  Identical attachment bytes within one message are also deduplicated. Generic
  inline images/logos are ignored. Other emails use plain text, falling back to
  inert HTML-to-text conversion. No email links or remote HTML resources are
  fetched.
- Attachments are limited to 10 MB, email text to 256 KB, and each message to ten
  receipt attachments. Unsupported documents cause an error for that message;
  later messages continue. Failed messages are retried on the next full scan.
- An immutable key uses owner, Gmail account, message ID, and MIME part. Private
  uploads and a transactional database function make retrying safe even if the
  process stops after upload or the queue response is lost. A resent email has a
  different message ID and still needs review for purchase duplication.
- The source tables retain message/part provenance and receipt links. Source
  records use a hash of the mailbox address and contain no OAuth credentials.
  Access is restricted to the receipt owner; writes and queue submission require
  the worker's service role. Gmail source links may require selecting the correct
  Google account in the browser.
- Email dates do not substitute for missing purchase dates. Missing amounts and
  package sizes stay unknown. PC Optimum points are preserved in review notes
  separately from cash; earned points never reduce a purchase's cash price.

The importer performs only Gmail GETs and the OAuth token refresh. It never sends,
archives, labels, deletes, marks read, or changes messages. Stop its process and
revoke the Google authorization to disable future pulls; existing private
receipts remain in Tortracker.

## Validation

    python -m unittest worker.test_email_import -v

These tests cover MIME alternatives, safe HTML conversion, attachment preference,
limits, mailbox identity, redacted failures, page progress, retry deduplication,
and the text-extraction boundary using fixtures. They do not demonstrate live
Gmail authorization or real receipt-extraction accuracy. Verify a limited real
pass after configuring the deployment and inspect its drafts before enabling the
polling service.
