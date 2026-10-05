"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Search,
  Plus,
  MapPin,
  List,
  ExternalLink,
  Tag,
  Upload,
  Camera,
  X,
} from "lucide-react";
import Papa from "papaparse";
import { useWorkspace, request, jsonPost } from "@/lib/use-workspace";
import { comparable, money, today } from "@/lib/money";
import type { Channel, Unit } from "@/lib/types";
const StoreMap = dynamic(() => import("@/components/store-map"), {
  ssr: false,
  loading: () => <div className="map-loading">Loading store locations…</div>,
});
const emptyObservation = () => ({
  item_id: "",
  branch_id: "",
  store_name: "",
  observed_on: today(),
  price: "",
  package_size: "",
  unit: "",
  regular_price: "",
  sale_price: "",
  source_url: "",
  channel: "in-store",
  conditions: "",
});
const emptyOffer = () => ({
  item_id: "",
  branch_ids: [] as string[],
  price: "",
  package_size: "",
  unit: "",
  regular_price: "",
  valid_from: today(),
  valid_to: today(),
  source_url: "",
  channel: "in-store",
  conditions: "",
});
const clean = (data: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      value === "" && key !== "conditions" ? null : value,
    ]),
  );
export default function Prices() {
  const { data, error, refresh } = useWorkspace();
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState(""),
    [view, setView] = useState("list");
  const [modal, setModal] = useState<"price" | "offer" | "csv" | null>(null),
    [formError, setFormError] = useState(""),
    [success, setSuccess] = useState(""),
    [busy, setBusy] = useState(false);
  const modalRef = useRef<HTMLElement>(null);
  const busyRef = useRef(false);
  busyRef.current = busy;
  useEffect(() => {
    if (!modal || !modalRef.current) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        modalRef.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]),a[href],input:not([disabled]),select,textarea",
        ) || [],
      );
    focusable()[0]?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        setModal(null);
      }
      if (event.key === "Tab") {
        const elements = focusable(),
          first = elements[0],
          last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, [modal]);
  const [observation, setObservation] = useState(emptyObservation),
    [offer, setOffer] = useState(emptyOffer),
    [csv, setCsv] = useState("");
  useEffect(() => {
    setQuery(new URLSearchParams(window.location.search).get("item") || "");
  }, []);
  const matching =
    data?.items.filter((item) =>
      item.name.toLowerCase().includes(query.toLowerCase()),
    ) || [];
  const item = data?.items.find((i) => i.id === selected) || matching[0];
  const groupIds =
    data?.items
      .filter((i) => i.comparison_group === item?.comparison_group)
      .map((i) => i.id) || [];
  const observations =
    data?.observations.filter((o) => groupIds.includes(o.item_id)) || [];
  const offers =
    data?.offers.filter(
      (o) =>
        groupIds.includes(o.item_id) &&
        o.valid_from <= today() &&
        o.valid_to >= today(),
    ) || [];
  const branchIds = [
    ...observations.map((o) => o.branch_id),
    ...(data?.offer_stores
      .filter((s) => offers.some((o) => o.id === s.offer_id))
      .map((s) => s.branch_id) || []),
  ];
  const mapStores = useMemo(
    () => data?.stores.filter((s) => branchIds.includes(s.id)) || [],
    [data, branchIds.join(",")],
  );
  function open(value: "price" | "offer" | "csv") {
    setModal(value);
    setFormError("");
    setSuccess("");
    setObservation({ ...emptyObservation(), item_id: item?.id || "" });
    setOffer({ ...emptyOffer(), item_id: item?.id || "" });
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      if (modal === "price")
        await request("/api/prices", jsonPost(clean(observation)));
      else if (modal === "offer")
        await request("/api/offers", jsonPost([clean(offer)]));
      else {
        const parsed = Papa.parse<Record<string, string>>(csv, {
          header: true,
          skipEmptyLines: "greedy",
        });
        if (parsed.errors.length)
          throw new Error(
            "The CSV could not be read: " + parsed.errors[0].message,
          );
        const rows = parsed.data.map((row, index) => {
          const item = data?.items.find(
            (i) =>
              i.name.toLowerCase() ===
              (row.item_name || "").trim().toLowerCase(),
          );
          if (!item)
            throw new Error("Row " + (index + 2) + ": unknown item name.");
          const branches = (row.store_branch || "")
            .split("|")
            .map((name) =>
              data?.stores.find(
                (s) => s.name.toLowerCase() === name.trim().toLowerCase(),
              ),
            );
          if (branches.some((branch) => !branch))
            throw new Error("Row " + (index + 2) + ": unknown store branch.");
          return clean({
            item_id: item.id,
            branch_ids: branches.map((s) => s!.id),
            price: row.price,
            package_size: row.package_size || "",
            unit: row.unit || "",
            regular_price: row.regular_price || "",
            valid_from: row.valid_from,
            valid_to: row.valid_to,
            source_url: row.source_url,
            channel: row.channel || "in-store",
            conditions: row.conditions || "",
          });
        });
        await request("/api/offers", jsonPost(rows));
      }
      setModal(null);
      setSuccess(
        modal === "price" ? "Price observation saved." : "Flyer offers saved.",
      );
      await refresh();
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const priceDisplay = (
    price: string,
    size: string | null,
    unit: Unit | null,
  ) => {
    const value = comparable(price, size, unit);
    return (
      <div className="price-value">
        <strong>{money(price)}</strong>
        <span>
          {value
            ? money(value.value.toFixed(4)) + " / " + value.unit
            : "Unit price unknown"}
        </span>
      </div>
    );
  };
  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">A BETTER-INFORMED GROCERY RUN</p>
          <h1>A little price perspective.</h1>
          <p className="muted">
            Recorded prices and valid offers from your neighborhood.
          </p>
        </div>
        <span className="page-number">03 / PRICES</span>
      </div>
      <section className="price-search">
        <div>
          <Search size={22} />
          <input
            aria-label="Search prices by item"
            placeholder="What’s on your grocery list?"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected("");
            }}
          />
        </div>
        <span>Compare within an item group</span>
      </section>
      <div className="item-chips" aria-label="Matching items">
        {matching.slice(0, 12).map((i) => (
          <button
            className={item?.id === i.id ? "item-chip selected" : "item-chip"}
            key={i.id}
            onClick={() => setSelected(i.id)}
          >
            {i.name}
          </button>
        ))}
      </div>
      <div className="toolbar">
        <div className="toolbar-actions">
          <button
            className="button primary"
            disabled={!data}
            onClick={() => open("price")}
          >
            <Plus size={17} />
            Add a price
          </button>
          <button
            className="button secondary"
            disabled={!data}
            onClick={() => open("offer")}
          >
            <Tag size={17} />
            Add flyer offer
          </button>
          <button
            className="button text"
            disabled={!data}
            onClick={() => open("csv")}
          >
            <Upload size={17} />
            Import CSV
          </button>
        </div>
        <div className="segmented">
          <button
            onClick={() => setView("list")}
            className={view === "list" ? "selected" : ""}
            aria-pressed={view === "list"}
          >
            <List size={16} />
            List
          </button>
          <button
            onClick={() => setView("map")}
            className={view === "map" ? "selected" : ""}
            aria-pressed={view === "map"}
          >
            <MapPin size={16} />
            Map
          </button>
        </div>
      </div>
      {error && (
        <p className="error" role="alert" aria-label="Error">
          {error}
        </p>
      )}
      {success && (
        <p className="success" role="status">
          {success}
        </p>
      )}
      {!data && !error && <p className="loading">Loading prices…</p>}
      {data && !item && (
        <div className="empty-state">
          <Search size={30} />
          <h3>No matching item.</h3>
          <p>
            Try an item name from your notebook, or confirm a receipt to add a
            new one.
          </p>
        </div>
      )}
      {item && (
        <>
          <div className="section-heading">
            <h2>{item.name}</h2>
            <span className="small muted">
              Comparison group: {item.comparison_group}
            </span>
          </div>
          {view === "map" && <StoreMap stores={mapStores} />}
          <section className="section">
            <div className="section-heading">
              <h2>
                Valid offers <span className="count">{offers.length}</span>
              </h2>
              <span className="small muted">Within the advertised dates</span>
            </div>
            <div className="offer-grid">
              {offers.map((o) => {
                const branches =
                  data?.offer_stores
                    .filter((s) => s.offer_id === o.id)
                    .map(
                      (s) =>
                        data.stores.find((b) => b.id === s.branch_id)?.name,
                    ) || [];
                return (
                  <article
                    className="offer-card"
                    key={o.id}
                    data-testid="offer-card"
                  >
                    <span className="badge">
                      <Tag size={13} />
                      FLYER OFFER
                    </span>
                    <h3>{branches.join(" · ")}</h3>
                    {priceDisplay(o.price, o.package_size, o.unit)}
                    <p className="small">
                      Valid {o.valid_from} to {o.valid_to}
                    </p>
                    <p className="conditions">
                      {o.conditions || "No additional conditions recorded."}
                    </p>
                    <span className="channel">{o.channel}</span>
                    <a
                      href={o.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="source-link"
                    >
                      Official source <ExternalLink size={14} />
                    </a>
                  </article>
                );
              })}
            </div>
            {offers.length === 0 && (
              <div className="empty-inline">
                No valid offers recorded for this group.
              </div>
            )}
          </section>
          <section className="section">
            <div className="section-heading">
              <h2>
                Recorded prices{" "}
                <span className="count" data-testid="observation-count">
                  {observations.length}
                </span>
              </h2>
              <span className="small muted">
                Historical observations · current prices may differ
              </span>
            </div>
            {observations.length ? (
              <div className="price-list">
                {observations.map((o) => {
                  const store = data?.stores.find((s) => s.id === o.branch_id);
                  return (
                    <article
                      className="price-row"
                      key={o.id}
                      data-testid="price-row"
                    >
                      <span className="store-icon">
                        <MapPin size={20} />
                      </span>
                      <div className="price-info">
                        <h3>{store?.name || o.store_name}</h3>
                        <span>
                          {store?.address || "Branch unknown"} · {o.observed_on}
                        </span>
                        <div className="price-tags">
                          <span className="channel">{o.channel}</span>
                          <span className="source-tag">
                            {o.source === "shelf"
                              ? "Shelf label"
                              : o.source === "receipt"
                                ? "Receipt"
                                : "Manual entry"}
                          </span>
                        </div>
                        {o.conditions && (
                          <p className="conditions">{o.conditions}</p>
                        )}
                        {(o.regular_price || o.sale_price) && (
                          <p className="small muted">
                            {o.regular_price &&
                              "Regular " + money(o.regular_price) + " "}
                            {o.sale_price &&
                              "Advertised sale " + money(o.sale_price)}
                          </p>
                        )}
                      </div>
                      {priceDisplay(o.price, o.package_size, o.unit)}
                      {o.source_url ? (
                        <a
                          aria-label="Open price source"
                          href={o.source_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLink size={17} />
                        </a>
                      ) : o.receipt_id ? (
                        <a
                          aria-label="Open source receipt"
                          href={"/capture/" + o.receipt_id}
                        >
                          <Camera size={17} />
                        </a>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state">
                <Tag size={30} />
                <h3>A price worth remembering?</h3>
                <p>Add a manual price or capture a receipt or shelf label.</p>
              </div>
            )}
          </section>
        </>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setModal(null);
          }}
        >
          <section
            ref={modalRef}
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <div className="section-heading">
              <h2 id="modal-title">
                {modal === "price"
                  ? "Record a price"
                  : modal === "offer"
                    ? "Record a flyer offer"
                    : "Import flyer offers"}
              </h2>
              <button
                className="icon-button"
                aria-label="Close dialog"
                disabled={busy}
                onClick={() => setModal(null)}
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={submit}>
              {modal === "csv" ? (
                <>
                  <p className="muted">
                    Use retailer data you’re permitted to import. Include an
                    official source URL for every offer.
                  </p>
                  <a
                    className="source-link"
                    href="/flyer-template.csv"
                    download
                  >
                    Download CSV template
                  </a>
                  <label>
                    Upload flyer CSV
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (file) setCsv(await file.text());
                      }}
                    />
                  </label>
                  <label>
                    CSV data
                    <textarea
                      aria-label="Flyer CSV data"
                      rows={9}
                      value={csv}
                      onChange={(e) => setCsv(e.target.value)}
                      required
                    />
                  </label>
                  <p className="small muted">
                    Use exact item and branch names from your notebook. Separate
                    multiple branches with |. The whole import is checked before
                    saving.
                  </p>
                </>
              ) : (
                <div className="form-grid">
                  <label className="span-two">
                    Item
                    <select
                      aria-label="Price item"
                      value={
                        modal === "price" ? observation.item_id : offer.item_id
                      }
                      required
                      onChange={(e) =>
                        modal === "price"
                          ? setObservation({
                              ...observation,
                              item_id: e.target.value,
                            })
                          : setOffer({ ...offer, item_id: e.target.value })
                      }
                    >
                      <option value="">Choose an item</option>
                      {data?.items.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {modal === "price" ? (
                    <>
                      <label className="span-two">
                        Branch
                        <select
                          aria-label="Price branch"
                          value={observation.branch_id}
                          onChange={(e) =>
                            setObservation({
                              ...observation,
                              branch_id: e.target.value,
                            })
                          }
                        >
                          <option value="">Branch unknown</option>
                          {data?.stores.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      {!observation.branch_id && (
                        <label className="span-two">
                          Store name
                          <input
                            aria-label="Price store name"
                            value={observation.store_name}
                            required
                            onChange={(e) =>
                              setObservation({
                                ...observation,
                                store_name: e.target.value,
                              })
                            }
                          />
                        </label>
                      )}
                      <label>
                        Observation date
                        <input
                          type="date"
                          required
                          value={observation.observed_on}
                          onChange={(e) =>
                            setObservation({
                              ...observation,
                              observed_on: e.target.value,
                            })
                          }
                        />
                      </label>
                    </>
                  ) : (
                    <fieldset className="span-two branch-choices">
                      <legend>Applicable branches</legend>
                      {data?.stores.map((s) => (
                        <label className="check-label" key={s.id}>
                          <input
                            type="checkbox"
                            checked={offer.branch_ids.includes(s.id)}
                            onChange={(e) =>
                              setOffer({
                                ...offer,
                                branch_ids: e.target.checked
                                  ? [...offer.branch_ids, s.id]
                                  : offer.branch_ids.filter(
                                      (id) => id !== s.id,
                                    ),
                              })
                            }
                          />
                          {s.name}
                        </label>
                      ))}
                    </fieldset>
                  )}
                  <label>
                    Package price
                    <input
                      aria-label="Package price"
                      type="number"
                      required
                      min="0"
                      step="0.0001"
                      value={
                        modal === "price" ? observation.price : offer.price
                      }
                      onChange={(e) =>
                        modal === "price"
                          ? setObservation({
                              ...observation,
                              price: e.target.value,
                            })
                          : setOffer({ ...offer, price: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Package size
                    <input
                      aria-label="Price package size"
                      type="number"
                      min="0.0001"
                      step="0.0001"
                      placeholder="Unknown"
                      value={
                        modal === "price"
                          ? observation.package_size
                          : offer.package_size
                      }
                      onChange={(e) =>
                        modal === "price"
                          ? setObservation({
                              ...observation,
                              package_size: e.target.value,
                            })
                          : setOffer({ ...offer, package_size: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Size unit
                    <select
                      aria-label="Price size unit"
                      value={modal === "price" ? observation.unit : offer.unit}
                      onChange={(e) =>
                        modal === "price"
                          ? setObservation({
                              ...observation,
                              unit: e.target.value,
                            })
                          : setOffer({ ...offer, unit: e.target.value })
                      }
                    >
                      <option value="">Unknown</option>
                      {["g", "kg", "ml", "l", "count"].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Channel
                    <select
                      aria-label="Price channel"
                      value={
                        modal === "price" ? observation.channel : offer.channel
                      }
                      onChange={(e) =>
                        modal === "price"
                          ? setObservation({
                              ...observation,
                              channel: e.target.value as Channel,
                            })
                          : setOffer({
                              ...offer,
                              channel: e.target.value as Channel,
                            })
                      }
                    >
                      {[
                        "in-store",
                        "online pickup",
                        "online delivery",
                        "unspecified",
                      ].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                  {modal === "offer" && (
                    <>
                      <label>
                        Valid from
                        <input
                          type="date"
                          required
                          value={offer.valid_from}
                          onChange={(e) =>
                            setOffer({ ...offer, valid_from: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        Valid through
                        <input
                          type="date"
                          required
                          value={offer.valid_to}
                          onChange={(e) =>
                            setOffer({ ...offer, valid_to: e.target.value })
                          }
                        />
                      </label>
                    </>
                  )}
                  <label className="span-two">
                    {modal === "offer"
                      ? "Official source URL"
                      : "Source URL (optional)"}
                    <input
                      aria-label="Source URL"
                      type="url"
                      required={modal === "offer"}
                      value={
                        modal === "price"
                          ? observation.source_url
                          : offer.source_url
                      }
                      onChange={(e) =>
                        modal === "price"
                          ? setObservation({
                              ...observation,
                              source_url: e.target.value,
                            })
                          : setOffer({ ...offer, source_url: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Regular price (if shown)
                    <input
                      type="number"
                      min="0"
                      step="0.0001"
                      value={
                        modal === "price"
                          ? observation.regular_price
                          : offer.regular_price
                      }
                      onChange={(e) =>
                        modal === "price"
                          ? setObservation({
                              ...observation,
                              regular_price: e.target.value,
                            })
                          : setOffer({
                              ...offer,
                              regular_price: e.target.value,
                            })
                      }
                    />
                  </label>
                  {modal === "price" && (
                    <label>
                      Advertised sale price (if shown)
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={observation.sale_price}
                        onChange={(e) =>
                          setObservation({
                            ...observation,
                            sale_price: e.target.value,
                          })
                        }
                      />
                    </label>
                  )}
                  <label className="span-two">
                    Purchase conditions
                    <textarea
                      aria-label="Purchase conditions"
                      rows={2}
                      value={
                        modal === "price"
                          ? observation.conditions
                          : offer.conditions
                      }
                      onChange={(e) =>
                        modal === "price"
                          ? setObservation({
                              ...observation,
                              conditions: e.target.value,
                            })
                          : setOffer({ ...offer, conditions: e.target.value })
                      }
                      placeholder="Membership, multibuy quantity, or other restrictions"
                    />
                  </label>
                </div>
              )}
              {formError && (
                <p role="alert" aria-label="Error" className="error">
                  {formError}
                </p>
              )}
              <button className="button primary full" disabled={busy}>
                {busy
                  ? "Saving…"
                  : modal === "price"
                    ? "Save price"
                    : modal === "offer"
                      ? "Save offer"
                      : "Import offers"}
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
