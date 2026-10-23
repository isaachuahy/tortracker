"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Camera, CircleHelp, ExternalLink, Inbox, Leaf, RefreshCw, Search, Tag } from "lucide-react";
import { useWorkspace } from "@/lib/use-workspace";
import { comparable, money, today } from "@/lib/money";
import { bestComparableOffer, latestObservation, monthlySpending, offerStores, saleBoundary, saleStatus, type SaleStatus, type TimedOffer } from "@/lib/dashboard";
import type { Unit } from "@/lib/types";

function unitPrice(price: string, size: string | null, unit: Unit | null) {
  const value = comparable(price, size, unit);
  return value ? money(value.value.toString()) + " / " + value.unit : "Unit price unknown";
}

function packageSize(size: string | null, unit: Unit | null) {
  return size && unit ? `${Number(size)} ${unit === "count" ? "count" : unit}` : "Package size unknown";
}

function Points({ offer }: { offer: TimedOffer }) {
  return offer.points ? <span className="dashboard-points">+{offer.points.toLocaleString("en-CA")} {offer.loyalty_program || "loyalty"} points</span> : null;
}

export default function Dashboard() {
  const { data, error, refresh } = useWorkspace();
  const [month, setMonth] = useState(today().slice(0, 7));
  const [query, setQuery] = useState("");
  const [saleFilter, setSaleFilter] = useState<SaleStatus | "all">("active");
  const [now, setNow] = useState(() => new Date());
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const rows = useMemo(() => data?.items
    .filter((item) => `${item.name} ${item.category} ${item.comparison_group}`.toLowerCase().includes(query.trim().toLowerCase()))
    .map((item) => {
      const latest = latestObservation(item, data.observations);
      return { item, latest, best: bestComparableOffer(item, latest, data, now) };
    }) ?? [], [data, query, now]);
  const counts = { active: 0, upcoming: 0, expired: 0 };
  for (const offer of data?.offers ?? []) counts[saleStatus(offer, now)]++;
  const sales = data?.offers.filter((offer) => saleFilter === "all" || saleStatus(offer, now) === saleFilter) ?? [];
  const spending = data ? monthlySpending(data, month) : null;
  const reviewCount = data?.receipts.filter((receipt) => receipt.status === "review").length ?? 0;
  const trackedCount = data ? new Set(data.observations.map((observation) => observation.item_id)).size : 0;
  async function refreshDashboard() {
    setRefreshing(true);
    await refresh();
    setNow(new Date());
    setRefreshing(false);
  }

  return <div className="grocery-dashboard">
    <div className="page-heading">
      <div>
        <p className="eyebrow">YOUR GROCERY DASHBOARD</p>
        <h1>A better basket starts here.</h1>
        <p className="muted">Your grocery costs, purchases, and offers in one place.</p>
      </div>
      <Link className="button" href="/capture"><Camera size={17} /> Add a receipt</Link>
    </div>

    <div className="toolbar">
      <label className="inline-label">Spending month<input type="month" aria-label="Dashboard spending month" value={month} onChange={(event) => setMonth(event.target.value)} required /></label>
      <button type="button" className="button secondary" onClick={refreshDashboard} disabled={refreshing}>
        <RefreshCw size={15} className={refreshing ? "spin" : ""} />{refreshing ? "Refreshing…" : "Refresh records"}
      </button>
    </div>

    {error && <div className="error" role="alert" aria-label="Error">{error}{data && " Your last loaded records are still shown."}</div>}
    {!data ? <div className="dashboard-loading panel" role="status" aria-live="polite">
      <Leaf size={28} /><h2>{error ? "Your notebook could not be loaded." : "Opening your grocery notebook…"}</h2>
      <p className="muted">{error ? "Use Refresh records to try again." : "Gathering your receipts, recorded prices, and sales."}</p>
    </div> : <>
      <section className="stats-grid dashboard-stats" aria-label="Grocery summary">
        <div className="stat featured">
          <span className="eyebrow">CONFIRMED SPENDING</span>
          <strong data-testid="dashboard-spending">{money(spending?.total)}{spending?.unknown && spending.total != null ? " + unknown" : ""}</strong>
          <span>{spending?.count} confirmed {spending?.count === 1 ? "receipt" : "receipts"} · {month}{spending?.unknown ? ` · ${spending.unknown} missing totals` : ""}</span>
        </div>
        <Link className="stat dashboard-stat-link" href="#groceries">
          <span className="eyebrow">ITEMS WITH PRICES</span><strong>{trackedCount}</strong><span>Across {data.items.length} grocery items <ArrowRight size={13} /></span>
        </Link>
        <Link className="stat dashboard-stat-link" href="#sales">
          <span className="eyebrow">ACTIVE SALES</span><strong data-testid="dashboard-active-sales">{counts.active}</strong><span>Valid now in Toronto <ArrowRight size={13} /></span>
        </Link>
        <Link className="stat dashboard-stat-link" href="/capture">
          <span className="eyebrow">READY TO REVIEW</span><strong>{reviewCount}</strong><span>Confirm before spending updates <ArrowRight size={13} /></span>
        </Link>
      </section>

      <section className="dashboard-source-strip" aria-label="Import grocery data">
        <span className="dashboard-strip-icon"><Inbox size={22} /></span>
        <div><strong>Bring your grocery records together.</strong><p>Import receipts and flyer offers. Review extracted receipts before they become part of your spending.</p></div>
        <Link className="source-link" href="/sources">Manage sources <ArrowRight size={16} /></Link>
      </section>

      <section className="section" id="groceries">
        <div className="section-heading">
          <div><p className="eyebrow">THE COST OF YOUR STAPLES</p><h2>Grocery items <span className="count">{rows.length}</span></h2></div>
          <label className="search-box"><Search size={17} /><input aria-label="Search grocery items" placeholder="Search items or categories" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        </div>
        <p className="dashboard-section-note">One row per item. Compare dated package prices with the lowest active offer in the same comparison group and unit.</p>
        {rows.length ? <div className="table-wrap dashboard-table-wrap" tabIndex={0} role="region" aria-label="Grocery unit costs, scroll horizontally for more columns">
          <table className="dashboard-items-table" aria-label="Grocery unit costs">
            <thead><tr><th scope="col">Grocery item</th><th scope="col">Latest package cost</th><th scope="col">Comparable unit cost</th><th scope="col">Store & recorded date</th><th scope="col">Lowest active unit cost</th></tr></thead>
            <tbody>{rows.map(({ item, latest, best }) => <tr key={item.id} data-testid="grocery-item-row">
              <td><Link className="dashboard-item-link" href={`/prices?item=${encodeURIComponent(item.name)}`}>{item.name}<ArrowRight size={13} /></Link><span className="table-sub">{item.category}</span></td>
              <td>{latest ? <><strong>{money(latest.price)}</strong><span className="table-sub">{packageSize(latest.package_size, latest.unit)}</span></> : <span className="muted">No recorded price</span>}</td>
              <td>{latest ? <><strong>{unitPrice(latest.price, latest.package_size, latest.unit)}</strong><span className="table-sub">{latest.channel}</span></> : <span className="muted">—</span>}</td>
              <td>{latest ? <>{latest.store_name || "Unknown store"}<span className="table-sub">{latest.observed_on} · {latest.source}</span>{latest.receipt_id ? <Link className="source-link" href={`/capture/${latest.receipt_id}`}>View receipt <ArrowRight size={12} /></Link> : latest.source_url ? <a className="source-link" href={latest.source_url} target="_blank" rel="noopener noreferrer">Price source <ExternalLink size={12} /></a> : null}</> : <span className="muted">Add a receipt or price</span>}</td>
              <td>{best ? <><a className="dashboard-deal-price" href={best.source_url} target="_blank" rel="noopener noreferrer">{unitPrice(best.price, best.package_size, best.unit)} <ExternalLink size={12} /></a><span className="table-sub">{money(best.price)} / {packageSize(best.package_size, best.unit)}</span><span className="table-sub">{data.items.find((candidate) => candidate.id === best.item_id)?.name}</span><span className="table-sub">{offerStores(data, best.id).join(" · ") || "Branch unknown"}</span><span className="table-sub">{best.channel}</span><Points offer={best} />{best.conditions && <span className="dashboard-deal-condition">{best.conditions}</span>}</> : <span className="muted">{latest && comparable(latest.price, latest.package_size, latest.unit) ? "No comparable active offer" : "Unit information needed"}</span>}</td>
            </tr>)}</tbody>
          </table>
        </div> : <div className="empty-state"><Search size={28} /><h3>{query ? "No matching grocery items." : "Your grocery list starts here."}</h3><p>{query ? "Try another item name or category." : "Add and confirm a receipt to record the items you buy."}</p>{!query && <Link className="button secondary" href="/capture">Capture a receipt</Link>}</div>}
        <p className="dashboard-table-note"><CircleHelp size={14} /> Unit costs use kg, L, or each. Unknown sizes stay unknown. Store, channel, and offer conditions still apply.</p>
      </section>

      <section className="section" id="sales">
        <div className="section-heading">
          <div><p className="eyebrow">KEEP AN EYE ON THE DATES</p><h2>Sales & discounts <span className="count">{sales.length}</span></h2></div>
          <Link className="button secondary" href="/prices"><Tag size={16} /> Add or import offers</Link>
        </div>
        <div className="dashboard-sale-filters" role="group" aria-label="Filter sales by validity">
          {(["active", "upcoming", "expired", "all"] as const).map((filter) => <button key={filter} type="button" className={saleFilter === filter ? "item-chip selected" : "item-chip"} aria-pressed={saleFilter === filter} onClick={() => setSaleFilter(filter)}>{filter === "all" ? "All sales" : filter[0].toUpperCase() + filter.slice(1)} <span>{filter === "all" ? data.offers.length : counts[filter]}</span></button>)}
        </div>
        {sales.length ? <div className="table-wrap dashboard-table-wrap" tabIndex={0} role="region" aria-label="Sales and discounts, scroll horizontally for more columns">
          <table className="dashboard-sales-table" aria-label="Sales and discounts">
            <thead><tr><th scope="col">Item & store</th><th scope="col">Sale price</th><th scope="col">Starts</th><th scope="col">Ends</th><th scope="col">Status & conditions</th><th scope="col">Source</th></tr></thead>
            <tbody>{sales.map((offer: TimedOffer) => <tr key={offer.id} data-testid="dashboard-sale-row">
              <td><strong>{data.items.find((item) => item.id === offer.item_id)?.name || "Unknown item"}</strong><span className="table-sub">{offerStores(data, offer.id).join(" · ") || "Branch unknown"}</span></td>
              <td><strong>{money(offer.price)}</strong>{offer.regular_price != null && <span className="table-sub">Regular {money(offer.regular_price)}</span>}<span className="table-sub">{packageSize(offer.package_size, offer.unit)}</span><span className="table-sub">{unitPrice(offer.price, offer.package_size, offer.unit)}</span><Points offer={offer} /></td>
              <td><time dateTime={offer.starts_at || offer.valid_from}>{saleBoundary(offer, "start")}</time></td>
              <td><time dateTime={offer.ends_at || offer.valid_to}>{saleBoundary(offer, "end")}</time></td>
              <td><span className={`dashboard-sale-status ${saleStatus(offer, now)}`}>{saleStatus(offer, now)}</span><span className="table-sub">{offer.channel}</span><span className="dashboard-deal-condition">{offer.conditions || "No additional conditions recorded"}</span></td>
              <td><a className="source-link" href={offer.source_url} target="_blank" rel="noopener noreferrer">Official source <ExternalLink size={13} /></a></td>
            </tr>)}</tbody>
          </table>
        </div> : <div className="empty-state"><Tag size={29} /><h3>{saleFilter === "active" ? "No active sales recorded." : `No ${saleFilter === "all" ? "" : saleFilter + " "}sales recorded.`}</h3><p>Imported offers appear here with their store, source, and validity period.</p><Link className="button secondary" href="/prices">Add a flyer offer</Link></div>}
        <p className="dashboard-table-note">Dates and times use America/Toronto. Timestamped sales end at the listed time; date-only sales include the entire final day. Points are shown separately from cash prices.</p>
        <p className="dashboard-table-note"><Link className="source-link" href="/loyalty">View personalized PC Optimum offers and points history <ArrowRight size={14} /></Link></p>
      </section>
    </>}
  </div>;
}
