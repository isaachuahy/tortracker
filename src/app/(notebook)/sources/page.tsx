"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDownToLine, ArrowUpRight, FileSpreadsheet, Mail, MapPin, RefreshCw, Tag, Upload } from "lucide-react";
import { jsonPost, request, useWorkspace } from "@/lib/use-workspace";
import { today } from "@/lib/money";
import "./sources.css";

type EmailSource = {
  status: "running" | "ready" | "partial" | "error";
  last_attempt_at: string;
  last_success_at: string | null;
  imported_count: number;
  scanned_count: number;
  last_error: string | null;
};
type Sources = {
  postal_code: string;
  saved_location: boolean;
  email_sources: EmailSource[];
  recent_imports: { id: string; receipt_id: string; source_url: string; imported_at: string }[];
};
const displayTime = (value: string) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto", dateStyle: "medium", timeStyle: "short",
}).format(new Date(value));
const describeError = (error: unknown) => error instanceof Error ? error.message : "Please try again.";

export default function SourcesPage() {
  const workspace = useWorkspace();
  const [sources, setSources] = useState<Sources | null>(null);
  const [sourceError, setSourceError] = useState("");
  const [feed, setFeed] = useState<{ configured: boolean } | null>(null);
  const [feedError, setFeedError] = useState("");
  const [postal, setPostal] = useState("");
  const [locationMessage, setLocationMessage] = useState("");
  const [locationError, setLocationError] = useState("");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [provider, setProvider] = useState<"flyer" | "pc-optimum">("flyer");
  const [csv, setCsv] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [importError, setImportError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const loadSources = useCallback(async (initialize = false) => {
    try {
      const result = await request<Sources>("/api/sources");
      setSources(result);
      if (initialize) setPostal(result.postal_code);
      setSourceError("");
    } catch (error) { setSourceError(describeError(error)); }
  }, []);
  useEffect(() => {
    void loadSources(true);
    void request<{ configured: boolean }>("/api/imports/flyers").then(setFeed).catch(error => setFeedError(describeError(error)));
  }, [loadSources]);

  async function saveLocation(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true); setLocationError(""); setLocationMessage("");
    try {
      const result = await request<{ postal_code: string }>("/api/sources", jsonPost({ postal_code: postal }));
      setPostal(result.postal_code);
      setLocationMessage("Location saved. Future feed requests will use this postal code.");
      await loadSources();
    } catch (error) { setLocationError(describeError(error)); }
    finally { setSaving(false); }
  }
  async function refreshFlyers() {
    setSyncing(true); setFeedError(""); setSyncMessage("");
    try {
      const result = await request<{ count: number }>("/api/imports/flyers", jsonPost({}));
      setSyncMessage(`${result.count} flyer offers saved. Existing source IDs were updated.`);
      await workspace.refresh();
    } catch (error) { setFeedError(describeError(error)); }
    finally { setSyncing(false); }
  }
  async function importOffers(event: React.FormEvent) {
    event.preventDefault();
    setImporting(true); setImportError(""); setImportMessage("");
    try {
      const result = await request<{ count: number }>(`/api/imports/offers?provider=${provider}`, {
        method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: csv,
      });
      setImportMessage(`${result.count} offers saved. You can now compare them on your dashboard.`);
      setCsv("");
      await workspace.refresh();
    } catch (error) { setImportError(describeError(error)); }
    finally { setImporting(false); }
  }
  function downloadTemplate() {
    const escape = (value: string) => '"' + value.replaceAll('"', '""') + '"';
    const header = "item_name,store_branch,price,package_size,unit,valid_from,valid_to,source_url,channel,conditions,starts_at,ends_at,points,loyalty_program,source_id,regular_price";
    const values = [workspace.data?.items[0]?.name ?? "Bananas", workspace.data?.stores[0]?.name ?? "Metro College Park", "2.99", "1", "kg", today(), today(), "https://www.pcoptimum.ca/", "in-store", "Example only — replace with the terms shown in your offer", "", "", provider === "pc-optimum" ? "1000" : "0", provider === "pc-optimum" ? "PC Optimum" : "", "replace-with-offer-id", ""];
    const blob = new Blob([header + "\n" + values.map(escape).join(",") + "\n"], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = "tortracker-offers-template.csv"; link.click(); URL.revokeObjectURL(url);
  }
  const email = sources?.email_sources[0];
  const stale = email && Date.now() - Date.parse(email.last_attempt_at) > 2 * 60 * 60 * 1000;
  const emailLabel = !sources ? "Checking…" : !email ? "Not configured" : stale ? "No recent sync" : email.status === "ready" ? "Last sync complete" : email.status === "running" ? "Import running" : email.status === "partial" ? email.last_error ? "Needs attention" : "More receipts pending" : "Import error";

  return <div className="sources-page">
    <div className="page-heading">
      <div><p className="eyebrow">A CLEAR TRAIL FOR EVERY PRICE</p><h1>Bring your groceries together.</h1><p className="muted">Import receipts, local flyers, and the offers you actually use.</p></div>
      <Link href="/dashboard" className="button secondary">View dashboard <ArrowUpRight size={16} /></Link>
    </div>
    <section className="source-location" aria-labelledby="location-title">
      <div><MapPin size={22} /><div><h2 id="location-title">Your shopping area</h2><p>Flyer prices and availability depend on the store and postal code.</p></div></div>
      <form onSubmit={saveLocation}>
        <label>Canadian postal code<input aria-label="Canadian postal code" autoComplete="postal-code" placeholder="M5V 1A1" value={postal} onChange={event => setPostal(event.target.value)} maxLength={7} required /></label>
        <button className="button primary" disabled={saving || !sources}>{saving ? "Saving…" : "Save location"}</button>
      </form>
      {locationMessage && <p className="success" role="status">{locationMessage}</p>}
      {locationError && <p className="error" role="alert">{locationError}</p>}
    </section>
    {sourceError && <div className="error" role="alert">{sourceError} <button className="button text" onClick={() => void loadSources(true)}>Retry source status</button></div>}
    <section className="source-cards" aria-label="Import sources">
      <article className="source-card">
        <div className="source-card-top"><span className="icon-well"><Mail size={22} /></span><span className="source-status">{sourceError ? "Status unavailable" : emailLabel}</span></div>
        <h2>Gmail receipts</h2><p>Receipt emails and attachments go into your private review queue. Confirm them before they count toward spending.</p>
        {email ? <div className="source-detail"><p>Last attempt: {displayTime(email.last_attempt_at)} (Toronto)</p>{email.last_success_at && <p>Last successful pass: {displayTime(email.last_success_at)}</p>}<p>{email.imported_count} imported · {email.scanned_count} scanned in the last pass</p>{email.last_error && <p className="error">{email.last_error}</p>}</div> : <p className="source-detail">A read-only Gmail connection must be configured for the import worker. No email is sent or changed.</p>}
        <div className="source-actions"><Link href="/capture" className="button secondary">Review receipts <ArrowUpRight size={15} /></Link><button className="button text" onClick={() => void loadSources()}>Check status</button></div>
      </article>
      <article className="source-card">
        <div className="source-card-top"><span className="icon-well"><FileSpreadsheet size={22} /></span><span className="source-status">{feedError && !feed ? "Status unavailable" : !feed ? "Checking…" : feed.configured ? "Feed configured" : "Feed not configured"}</span></div>
        <h2>Local flyers</h2><p>Pull a configured retailer or licensed flyer feed. Each offer keeps its source, store, price, and validity period.</p>
        <p className="source-detail">{feed?.configured ? "Refresh pulls the current feed for your saved area. Check conditions before shopping." : "You can import flyer CSV or JSON below while a feed is being set up."}</p>
        <div className="source-actions"><button className="button primary" disabled={!feed?.configured || syncing} onClick={() => void refreshFlyers()}><RefreshCw size={15} />{syncing ? "Importing…" : "Refresh flyers"}</button><a href="#offer-import" className="button text" onClick={() => setProvider("flyer")}>Import a file</a></div>
        {feedError && <p className="error" role="alert">{feedError} Existing offers have been kept.</p>}
        {syncMessage && <p className="success" role="status">{syncMessage}</p>}
      </article>
      <article className="source-card">
        <div className="source-card-top"><span className="icon-well"><Tag size={22} /></span><span className="source-status">Import available</span></div>
        <h2>PC Optimum</h2><p>Track item offers and bonus points alongside cash prices, including dates and the offer’s purchase conditions.</p>
        <p className="source-detail">Direct account sync is not connected. Import your offers below; receipt emails can use the Gmail importer. Points never reduce the displayed cash price.</p>
        <div className="source-actions"><a href="#offer-import" className="button secondary" onClick={() => setProvider("pc-optimum")}>Import PC offers <Upload size={15} /></a><a href="https://www.pcoptimum.ca/" target="_blank" rel="noreferrer" className="button text">Open PC Optimum <ArrowUpRight size={15} /></a></div>
      </article>
    </section>
    <section className="source-import" id="offer-import" aria-labelledby="import-title">
      <div className="section-heading"><div><p className="eyebrow">YOUR SOURCE, YOUR RECORDS</p><h2 id="import-title">Import flyer or points offers</h2></div><button className="button secondary" onClick={downloadTemplate}><ArrowDownToLine size={16} />Download CSV template</button></div>
      <p className="muted">Use one row per item and store. Replace the template’s example values with your source. Reimporting the same source ID updates the offer.</p>
      <form onSubmit={importOffers}>
        <div className="source-import-controls"><label>Offer source<select aria-label="Offer source" value={provider} onChange={event => setProvider(event.target.value as typeof provider)} disabled={importing}><option value="flyer">Retailer flyer</option><option value="pc-optimum">PC Optimum offers</option></select></label>
        <button type="button" className="button secondary" disabled={importing} onClick={() => fileInput.current?.click()}><Upload size={16} />Choose CSV or JSON</button>
        <input type="file" accept=".csv,.json,text/csv,application/json" ref={fileInput} className="visually-hidden" aria-label="Upload offers file" onChange={async event => {
          const file = event.target.files?.[0]; if (!file) return;
          setImportError(""); setImportMessage("");
          if (file.size > 2 * 1024 * 1024) { setImportError("Choose a file under 2 MiB."); return; }
          try { setCsv(await file.text()); } catch { setImportError("The file could not be read. Please choose it again."); }
          event.target.value = "";
        }} /></div>
        <label>Offer data<textarea aria-label="Offer import data" value={csv} onChange={event => setCsv(event.target.value)} rows={7} disabled={importing} placeholder="Paste CSV or JSON, or choose a file above." required spellCheck={false} /></label>
        <details><summary>Format and matching guide</summary><p>Required columns: <code>item_name, store_branch, price, package_size, unit, valid_from, valid_to, source_url, channel, conditions</code>. Leave size and unit blank when unknown. Dates use YYYY-MM-DD and include the final day in Toronto.</p><p>Optional: <code>source_id, regular_price, starts_at, ends_at, points, loyalty_program</code>. Record a regular price only when your source shows one. Exact times need an offset (for example 2026-10-23T09:00:00-04:00); the end time is exclusive. Selecting PC Optimum fills in the loyalty program; for retailer files with points, set <code>loyalty_program</code> to <code>PC Optimum</code>. Cash prices must be decimal strings in JSON.</p><p>For a multipack, enter the total size of the priced package. Keep minimum purchases and member requirements in conditions.</p>
          {workspace.data && <div className="source-match-lists"><div><h3>Exact item names</h3><p>{workspace.data.items.map(item => item.name).join(" · ")}</p></div><div><h3>Exact store branches</h3><p>{workspace.data.stores.map(store => store.name).join(" · ")}</p></div></div>}
        </details>
        <button className="button primary" disabled={importing || !csv.trim()}>{importing ? "Importing…" : "Save imported offers"}<ArrowUpRight size={16} /></button>
      </form>
      {importError && <p className="error" role="alert">{importError}</p>}
      {importMessage && <p className="success" role="status">{importMessage} <Link href="/dashboard">View dashboard →</Link></p>}
    </section>
    {sources && <section className="section"><div className="section-heading"><h2>Recent email imports</h2><span className="muted small">Times shown in Toronto</span></div>{sources.recent_imports.length ? <div className="source-recent">{sources.recent_imports.map(entry => <div key={entry.id}><Mail size={17} /><span>{displayTime(entry.imported_at)}</span><Link href={`/capture/${entry.receipt_id}`}>Review receipt <ArrowUpRight size={14} /></Link><a href={entry.source_url} target="_blank" rel="noreferrer">Original email <ArrowUpRight size={14} /></a></div>)}</div> : <p className="source-empty">No email receipts imported yet. You can still <Link href="/capture">upload a receipt</Link> to start tracking.</p>}</section>}
  </div>;
}
