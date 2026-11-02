"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, BadgePercent, Check, ExternalLink, FileJson, Gift, RefreshCw, Search } from "lucide-react";
import { jsonPost, request } from "@/lib/use-workspace";
import { money } from "@/lib/money";
import { MAX_LOYALTY_IMPORT_BYTES, loyaltyImportSchema, loyaltyOfferStatus, type LoyaltyData, type LoyaltyOffer } from "@/lib/loyalty";
import "./loyalty.css";

type ImportPayload = ReturnType<typeof loyaltyImportSchema.parse>;
type Validity = "active" | "upcoming" | "expired" | "unknown";
const emptyImport = JSON.stringify({ offers: [], transactions: [] }, null, 2);
const exampleImport = JSON.stringify({
  offers: [{
    source_id: "<stable offer ID from PC Optimum>",
    title: "<exact offer title>",
    scope: "unknown",
    points: null,
    points_multiplier: null,
    minimum_spend: null,
    minimum_quantity: null,
    starts_at: null,
    ends_at: null,
    valid_from: null,
    valid_to: null,
    activation_state: "unknown",
    terms: "<full offer conditions from the page>",
    source_url: "https://www.pcoptimum.ca/",
    observed_at: "<ISO timestamp when the page was read>",
  }],
  transactions: [{
    source_id: "<stable transaction ID from PC Optimum>",
    points_delta: "<signed integer from the transaction>",
    type: "unknown",
    description: "<exact transaction description>",
    occurred_at: null,
    merchant: null,
    source_url: "https://www.pcoptimum.ca/",
    observed_at: "<ISO timestamp when the page was read>",
  }],
}, null, 2);

function timestamp(value: string | null | undefined) {
  if (!value || Number.isNaN(Date.parse(value))) return "Unknown";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto", year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(new Date(value));
}

function reward(offer: LoyaltyOffer) {
  const details: string[] = [];
  if (offer.points != null) details.push(`${offer.points.toLocaleString("en-CA")} points`);
  if (offer.points_multiplier != null) details.push(`${offer.points_multiplier}× points`);
  return details.join(" · ") || "See reward conditions";
}

const validityLabel: Record<Validity, string> = {
  active: "Current dates", upcoming: "Upcoming", expired: "Expired", unknown: "Validity unknown",
};

export default function Loyalty() {
  const [data, setData] = useState<LoyaltyData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState("all");
  const [validity, setValidity] = useState<Validity | "all">("all");
  const [draft, setDraft] = useState(emptyImport);
  const [reviewed, setReviewed] = useState<ImportPayload | null>(null);
  const [importError, setImportError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setData(await request<LoyaltyData>("/api/loyalty"));
      setLoadError("");
      setNow(new Date());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load your PC Optimum records.");
    } finally {
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const filteredOffers = useMemo(() => data?.offers.filter((offer) =>
    (scope === "all" || offer.scope === scope) &&
    (validity === "all" || loyaltyOfferStatus(offer, now) === validity) &&
    `${offer.title} ${offer.terms}`.toLowerCase().includes(search.trim().toLowerCase()),
  ) ?? [], [data, now, scope, validity, search]);
  const currentOffers = data?.offers.filter((offer) => loyaltyOfferStatus(offer, now) === "active").length ?? 0;
  const lastObserved = data ? [...data.offers, ...data.transactions]
    .map((record) => record.observed_at)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] : null;

  function changeDraft(value: string) {
    setDraft(value);
    setReviewed(null);
    setImportError("");
    setSuccess("");
  }

  function reviewImport() {
    setImportError("");
    setSuccess("");
    setReviewed(null);
    if (new TextEncoder().encode(draft).byteLength > MAX_LOYALTY_IMPORT_BYTES) {
      setImportError("Keep each JSON import under 2 MB.");
      return;
    }
    try {
      const parsed = JSON.parse(draft);
      const result = loyaltyImportSchema.safeParse(parsed);
      if (!result.success) {
        setImportError(result.error.issues.map((issue) => `${issue.path.join(".") || "Import"}: ${issue.message}`).join("; "));
        return;
      }
      setReviewed(result.data);
    } catch {
      setImportError("This is not valid JSON. Check the quotation marks, commas, and brackets, then review again.");
    }
  }

  async function saveImport(event: React.FormEvent) {
    event.preventDefault();
    if (!reviewed || saving) return;
    setSaving(true);
    setImportError("");
    setSuccess("");
    try {
      const result = await request<{ offers: number; transactions: number }>("/api/loyalty", jsonPost(reviewed));
      setSuccess(`Saved ${result.offers} offers and ${result.transactions} transactions. Existing source IDs are updated; older observations do not replace newer records.`);
      setDraft(emptyImport);
      setReviewed(null);
      await load();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "The records could not be saved. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="loyalty-page">
    <div className="page-heading">
      <div>
        <p className="eyebrow">YOUR LOYALTY NOTEBOOK</p>
        <h1>Make your points count.</h1>
        <p className="muted">Personalized PC Optimum offers and the point movements you’ve recorded.</p>
      </div>
      <a className="button secondary" href="https://www.pcoptimum.ca/" target="_blank" rel="noopener noreferrer">Open PC Optimum <ExternalLink size={16} /></a>
    </div>

    <section className="loyalty-browser-note" aria-label="Browser-agent connection status">
      <Gift size={23} />
      <div><strong>Browser-agent imports</strong><p>This app has no connected PC Optimum browser session. Live account sync requires a supported browser agent signed in to your account. Import its reviewed offer and transaction records below.</p><p>PC Optimum may load weekly offers when you sign in or view them.</p></div>
      <a className="source-link" href="#loyalty-import">Import records <ArrowRight size={15} /></a>
    </section>

    <div className="toolbar loyalty-toolbar">
      <p className="small muted">Last observed: {lastObserved ? timestamp(lastObserved) : "No records imported"}</p>
      <button type="button" className="button secondary" onClick={load} disabled={refreshing}><RefreshCw size={15} className={refreshing ? "spin" : ""} />{refreshing ? "Refreshing…" : "Refresh PC records"}</button>
    </div>
    {loadError && <p role="alert" className="error">{loadError}{data ? " Your last loaded records remain visible." : ""}</p>}
    {!data && !loadError && <div className="loyalty-loading panel" role="status">Loading your PC Optimum records…</div>}

    {data && <>
      <section className="stats-grid loyalty-stats" aria-label="PC Optimum records summary">
        <div className="stat featured"><span className="eyebrow">RECORDED OFFERS</span><strong>{data.offers.length}</strong><span>Personalized items, categories, and baskets</span></div>
        <div className="stat"><span className="eyebrow">CURRENT OFFER DATES</span><strong>{currentOffers}</strong><span>Only offers with a recorded validity period</span></div>
        <div className="stat"><span className="eyebrow">POINT MOVEMENTS</span><strong>{data.transactions.length}</strong><span>Imported history, not an account balance</span></div>
      </section>

      <section className="section" aria-labelledby="loyalty-offers-heading">
        <div className="section-heading"><div><p className="eyebrow">READ THE SMALL PRINT</p><h2 id="loyalty-offers-heading">Personalized offers <span className="count">{filteredOffers.length}</span></h2></div></div>
        <div className="loyalty-filters">
          <label className="search-box"><Search size={17} /><input aria-label="Search PC Optimum offers" placeholder="Search titles or conditions" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <label>Offer applies to<select aria-label="Filter offer scope" value={scope} onChange={(event) => setScope(event.target.value)}><option value="all">All offers</option><option value="item">An item</option><option value="category">A category</option><option value="basket">The basket</option><option value="unknown">Scope unknown</option></select></label>
          <label>Validity<select aria-label="Filter offer validity" value={validity} onChange={(event) => setValidity(event.target.value as Validity | "all")}><option value="all">All dates</option><option value="active">Current dates</option><option value="upcoming">Upcoming</option><option value="expired">Expired</option><option value="unknown">Validity unknown</option></select></label>
        </div>
        {filteredOffers.length ? <div className="loyalty-offer-grid">{filteredOffers.map((offer) => {
          const status = loyaltyOfferStatus(offer, now);
          return <article className="loyalty-offer-card" key={offer.id} data-testid="loyalty-offer-card">
            <div className="loyalty-offer-meta"><span className="loyalty-scope"><BadgePercent size={14} />{offer.scope === "unknown" ? "Scope unknown" : `${offer.scope} offer`}</span><span className={`loyalty-validity ${status}`}>{validityLabel[status]}</span></div>
            <h3>{offer.title}</h3><p className="loyalty-reward">{reward(offer)}</p>
            <div className="loyalty-thresholds">
              {offer.minimum_spend != null && <span>Spend at least {money(offer.minimum_spend)}</span>}
              {offer.minimum_quantity != null && <span>Buy at least {offer.minimum_quantity} qualifying {offer.minimum_quantity === 1 ? "item" : "items"}</span>}
            </div>
            <p className="loyalty-date-window">{offer.starts_at || offer.ends_at ? <>
              {offer.starts_at ? <>Starts <time dateTime={offer.starts_at}>{timestamp(offer.starts_at)}</time></> : "Start unknown"}
              <br />
              {offer.ends_at ? <>Ends <time dateTime={offer.ends_at}>{timestamp(offer.ends_at)}</time></> : "End unknown"}
            </> : <>
              {offer.valid_from ? <>Starts <time dateTime={offer.valid_from}>{offer.valid_from}</time></> : "Start unknown"}
              <br />
              {offer.valid_to ? <>Ends <time dateTime={offer.valid_to}>{offer.valid_to}</time> · end of day</> : "End unknown"}
            </>}</p>
            <p className="loyalty-account-state">Account state when observed: <strong>{offer.activation_state === "active" ? "Loaded" : offer.activation_state === "available" ? "Available to load" : "Unknown"}</strong></p>
            <details className="loyalty-terms" open><summary>Full offer conditions</summary><p>{offer.terms || "No conditions were recorded."}</p></details>
            <footer><span>Observed {timestamp(offer.observed_at)}</span><a className="source-link" href={offer.source_url} target="_blank" rel="noopener noreferrer">View source <ExternalLink size={13} /></a></footer>
          </article>;
        })}</div> : <div className="empty-state"><Gift size={29} /><h3>{data.offers.length ? "No offers match these filters." : "Your personal offers belong here."}</h3><p>{data.offers.length ? "Try another scope, validity period, or search." : "Import offers read from your PC Optimum account to keep their rewards, thresholds, and conditions together."}</p>{!data.offers.length && <a className="button secondary" href="#loyalty-import">Import offer records</a>}</div>}
        <p className="loyalty-note">Times use America/Toronto. Exact intervals end at the listed time; date-only offers include the final day. A known end can establish expiry, but both bounds are needed to verify current dates. Loaded status does not establish current validity.</p>
      </section>

      <section className="section" aria-labelledby="loyalty-ledger-heading">
        <div className="section-heading"><div><p className="eyebrow">WHAT MOVED, AND WHEN</p><h2 id="loyalty-ledger-heading">Points history <span className="count">{data.transactions.length}</span></h2></div></div>
        <p className="loyalty-section-note">Earned points, redemptions, and adjustments stay separate from grocery spending. Imported history may be incomplete, so no account balance is inferred.</p>
        {data.transactions.length ? <div className="table-wrap loyalty-ledger-wrap" tabIndex={0} role="region" aria-label="PC Optimum points history, scroll horizontally for more columns"><table aria-label="PC Optimum points history"><thead><tr><th scope="col">Transaction</th><th scope="col">Occurred</th><th scope="col">Type</th><th scope="col" className="align-right">Points change</th><th scope="col">Evidence</th></tr></thead><tbody>{data.transactions.map((transaction) => <tr key={transaction.id} data-testid="loyalty-transaction-row"><td><strong>{transaction.description}</strong><span className="table-sub">{transaction.merchant || "Merchant unknown"}</span></td><td>{timestamp(transaction.occurred_at)}</td><td className="loyalty-transaction-type">{transaction.type}</td><td className="align-right"><strong className={transaction.points_delta > 0 ? "loyalty-earned" : transaction.points_delta < 0 ? "loyalty-redeemed" : ""}>{new Intl.NumberFormat("en-CA", { signDisplay: "always" }).format(transaction.points_delta)}</strong></td><td><a className="source-link" href={transaction.source_url} target="_blank" rel="noopener noreferrer">View source <ExternalLink size={13} /></a><span className="table-sub">Observed {timestamp(transaction.observed_at)}</span>{transaction.receipt_id && <Link className="source-link" href={`/capture/${transaction.receipt_id}`}>Linked receipt <ArrowRight size={12} /></Link>}</td></tr>)}</tbody></table></div> : <div className="empty-state"><FileJson size={28} /><h3>No point movements recorded.</h3><p>Import transaction history from PC Optimum to see earned and redeemed points here.</p></div>}
      </section>
    </>}

    <section className="section panel loyalty-import" id="loyalty-import" aria-labelledby="loyalty-import-heading">
      <div className="section-heading"><div><p className="eyebrow">BRING YOUR OWN ACCOUNT RECORDS</p><h2 id="loyalty-import-heading">Review a browser-agent import</h2></div><FileJson size={24} /></div>
      <p className="muted">Paste JSON extracted from the offers and transaction pages you can view in your PC Optimum account. Review it here before saving.</p>
      <details className="loyalty-import-help"><summary>Instructions for your browser agent</summary><ol><li>Open PC Optimum in a supported browser session and let the account owner complete sign-in.</li><li>Read personalized offers and transaction history. Preserve full conditions, stable source IDs, source links, and the time each page was observed.</li><li>Return separate <code>offers</code> and <code>transactions</code> arrays. Keep missing rewards, thresholds, and dates null. If only an expiry is shown, record it and leave the start null. Never invent a start date to fill the interval.</li><li>Use exact timestamps when the source provides a time and timezone; otherwise use calendar dates. If either exact timestamp is recorded, the exact bounds take precedence and calendar dates do not fill a missing side.</li><li>Use positive points for earned entries and negative points for redemptions. Do not turn points into grocery spending or invent an account balance.</li><li>Paste the records below, review the import, and save. Import account records only; authentication details are not part of this format.</li></ol><p>Viewing offers can automatically load them in PC Optimum. An agent should report which pages it visited and whether the account’s offer state changed.</p></details>
      <form onSubmit={saveImport}>
        <div className="loyalty-import-actions"><label>Upload JSON<input type="file" accept="application/json,.json" disabled={saving} onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          if (file.size > MAX_LOYALTY_IMPORT_BYTES) { setImportError("Choose a JSON file up to 2 MB."); return; }
          try { changeDraft(await file.text()); } catch { setImportError("The file could not be read. Try pasting its JSON instead."); }
        }} /></label><button type="button" className="button secondary" disabled={saving} onClick={() => changeDraft(exampleImport)}>Load example format</button></div>
        <label>Editable import JSON<textarea aria-label="PC Optimum import JSON" value={draft} onChange={(event) => changeDraft(event.target.value)} rows={15} spellCheck={false} disabled={saving} /></label>
        <p className="loyalty-note">The example is a format guide with placeholders. Replace it with observed records. Stable source IDs make repeated imports update the same records. No cash-price fields belong in this import.</p>
        {importError && <p className="error" role="alert" aria-label="PC Optimum import error">{importError}</p>}
        {reviewed && <div className="loyalty-import-review" role="status"><Check size={18} /><div><strong>Ready to save {reviewed.offers.length} offers and {reviewed.transactions.length} transactions.</strong><p>Check titles, terms, dates, and signed point changes in the JSON above. Editing it requires another review.</p></div></div>}
        {success && <p className="success" role="status">{success}</p>}
        <div className="loyalty-import-actions"><button type="button" className="button secondary" disabled={saving} onClick={reviewImport}>Review imported JSON</button><button type="submit" className="button primary" disabled={!reviewed || saving}>{saving ? "Saving…" : "Save reviewed records"}</button></div>
      </form>
    </section>
  </div>;
}
