"use client";
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  FileText,
  LoaderCircle,
  Plus,
  Trash2,
  Search,
  RotateCcw,
} from "lucide-react";
import type { Line, Receipt } from "@/lib/types";
import { useWorkspace, request, jsonPost } from "@/lib/use-workspace";
import { reconciliation } from "@/lib/money";
type Detail = {
  receipt: Receipt;
  lines: Line[];
  file_url?: string;
  job?: { last_error: string | null };
};
const nullable = (value: string) => (value === "" ? null : value);
const newLine = (): Line => ({
  original_text: "",
  item_name: "",
  category: "Other",
  comparison_group: "",
  quantity: null,
  package_size: null,
  unit: null,
  discount: null,
  line_amount: null,
  regular_price: null,
  sale_price: null,
  uncertain: true,
});
export default function Review({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params),
    { data: workspace } = useWorkspace();
  const [detail, setDetail] = useState<Detail | null>(null),
    [receipt, setReceipt] = useState<Receipt | null>(null),
    [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState("");
  const load = useCallback(async () => {
    try {
      const value = await request<Detail>("/api/receipts/" + id);
      setDetail(value);
      setReceipt(value.receipt);
      setLines(value.lines);
    } catch (error) {
      setError((error as Error).message);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!detail || !["queued", "processing"].includes(detail.receipt.status))
      return;
    const timer = setInterval(() => void load(), 1000);
    return () => clearInterval(timer);
  }, [detail, load]);
  const updateReceipt = (field: keyof Receipt, value: unknown) => {
    setSaved("");
    setReceipt((r) => (r ? { ...r, [field]: value } : r));
  };
  const updateLine = (index: number, field: keyof Line, value: unknown) => {
    setSaved("");
    setLines((current) =>
      current.map((line, i) =>
        i === index ? { ...line, [field]: value } : line,
      ),
    );
  };
  async function save(confirm: boolean) {
    if (!receipt) return;
    setBusy(true);
    setError("");
    setSaved("");
    try {
      await request(
        "/api/receipts/" + id,
        jsonPost({
          version: receipt.version,
          confirm,
          draft: { ...receipt, lines },
        }),
      );
      await load();
      setSaved(
        confirm
          ? "Receipt confirmed. Your notebook is up to date."
          : "Changes saved.",
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!detail || !receipt)
    return (
      <div>
        {error ? (
          <p role="alert" aria-label="Error" className="error">
            {error}
          </p>
        ) : (
          <p className="loading">Opening your capture…</p>
        )}
      </div>
    );
  const processing = ["queued", "processing"].includes(detail.receipt.status),
    failed = detail.receipt.status === "failed";
  const issues =
    receipt.kind === "receipt" ? reconciliation(receipt, lines) : [];
  return (
    <div>
      <Link href="/capture" className="back-link">
        <ArrowLeft size={16} />
        All captures
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOU GET THE FINAL SAY</p>
          <h1>
            {receipt.status === "confirmed"
              ? "Your confirmed record."
              : "A quick second look."}
          </h1>
          <p className="muted">{receipt.file_name}</p>
        </div>
        <span className={"status " + receipt.status}>{receipt.status}</span>
      </div>
      {processing ? (
        <section className="processing-card">
          <LoaderCircle className="spin" size={36} />
          <h2>Reading the details.</h2>
          <p>You can close this page. We’ll keep working on your capture.</p>
        </section>
      ) : failed ? (
        <section className="processing-card">
          <FileText size={36} />
          <h2>This capture needs another try.</h2>
          <p>
            {detail.job?.last_error ||
              "We couldn’t finish processing this file."}
          </p>
          <button
            className="button primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await request("/api/receipts/" + id + "/retry", {
                  method: "POST",
                });
                await load();
              } catch (error) {
                setError((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <RotateCcw size={17} />
            Retry processing
          </button>
        </section>
      ) : (
        <div className="review-layout">
          <section className="review-editor">
            <div className="panel">
              <div className="section-heading">
                <h2>The purchase</h2>
                <span className="small muted">Blank means unknown</span>
              </div>
              <div className="form-grid">
                <label>
                  Store
                  <input
                    aria-label="Store"
                    value={receipt.store_name || ""}
                    maxLength={160}
                    onChange={(e) =>
                      updateReceipt("store_name", nullable(e.target.value))
                    }
                  />
                </label>
                <label>
                  Purchase date
                  <input
                    type="date"
                    value={receipt.purchase_date || ""}
                    onChange={(e) =>
                      updateReceipt("purchase_date", nullable(e.target.value))
                    }
                  />
                </label>
                <label className="span-two">
                  Store branch
                  <select
                    aria-label="Store branch"
                    value={receipt.branch_id || ""}
                    onChange={(e) => {
                      const store = workspace?.stores.find(
                        (s) => s.id === e.target.value,
                      );
                      setReceipt((r) =>
                        r
                          ? {
                              ...r,
                              branch_id: nullable(e.target.value),
                              store_name: store?.name || r.store_name,
                            }
                          : r,
                      );
                    }}
                  >
                    <option value="">
                      Branch unknown · won’t appear on map
                    </option>
                    {workspace?.stores.map((s) => (
                      <option value={s.id} key={s.id}>
                        {s.name} · {s.address}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <section className="panel">
              <div className="section-heading">
                <h2>
                  Items <span className="count">{lines.length}</span>
                </h2>
                <button
                  className="button text small-button"
                  onClick={() => setLines([...lines, newLine()])}
                >
                  <Plus size={16} />
                  Add item
                </button>
              </div>
              <datalist id="known-items">
                {workspace?.items.map((item) => (
                  <option key={item.id} value={item.name} />
                ))}
              </datalist>
              {lines.map((line, index) => (
                <fieldset
                  key={line.id || index}
                  className={
                    "line-editor " + (line.uncertain ? "uncertain" : "")
                  }
                >
                  <legend>
                    Item {index + 1}
                    {line.uncertain ? " · please check" : ""}
                  </legend>
                  <div className="line-heading">
                    <span className="small muted">
                      Original: {line.original_text || "Not recorded"}
                    </span>
                    <div className="line-tools">
                      <Link
                        aria-label={"Search prices for item " + (index + 1)}
                        href={
                          "/prices?item=" + encodeURIComponent(line.item_name)
                        }
                      >
                        <Search size={16} />
                      </Link>
                      <button
                        className="icon-button"
                        aria-label={"Remove item " + (index + 1)}
                        onClick={() =>
                          setLines(lines.filter((_, i) => i !== index))
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="form-grid">
                    <label>
                      Item name
                      <input
                        aria-label={"Item " + (index + 1) + " name"}
                        list="known-items"
                        value={line.item_name}
                        maxLength={160}
                        onChange={(e) => {
                          const item = workspace?.items.find(
                            (item) => item.name === e.target.value,
                          );
                          setLines((current) =>
                            current.map((line, i) =>
                              i === index
                                ? {
                                    ...line,
                                    item_name: e.target.value,
                                    comparison_group:
                                      item?.comparison_group || e.target.value,
                                    category: item?.category || line.category,
                                  }
                                : line,
                            ),
                          );
                        }}
                      />
                    </label>
                    <label>
                      Category
                      <select
                        aria-label={"Item " + (index + 1) + " category"}
                        value={line.category}
                        onChange={(e) =>
                          updateLine(index, "category", e.target.value)
                        }
                      >
                        {[
                          "Produce",
                          "Dairy",
                          "Eggs",
                          "Meat",
                          "Bakery",
                          "Pantry",
                          "Household",
                          "Other",
                        ].map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Quantity
                      <input
                        aria-label={"Item " + (index + 1) + " quantity"}
                        type="number"
                        min="0.0001"
                        step="0.0001"
                        value={line.quantity || ""}
                        placeholder="Unknown"
                        onChange={(e) =>
                          updateLine(
                            index,
                            "quantity",
                            nullable(e.target.value),
                          )
                        }
                      />
                    </label>
                    <label>
                      Line amount paid
                      <input
                        aria-label={"Item " + (index + 1) + " amount"}
                        type="number"
                        step="0.01"
                        value={line.line_amount || ""}
                        placeholder="Unknown"
                        onChange={(e) =>
                          updateLine(
                            index,
                            "line_amount",
                            nullable(e.target.value),
                          )
                        }
                      />
                    </label>
                    <label>
                      Package size
                      <input
                        aria-label={"Item " + (index + 1) + " package size"}
                        type="number"
                        min="0.0001"
                        step="0.0001"
                        value={line.package_size || ""}
                        placeholder="Unknown"
                        onChange={(e) =>
                          updateLine(
                            index,
                            "package_size",
                            nullable(e.target.value),
                          )
                        }
                      />
                    </label>
                    <label>
                      Size unit
                      <select
                        aria-label={"Item " + (index + 1) + " unit"}
                        value={line.unit || ""}
                        onChange={(e) =>
                          updateLine(index, "unit", nullable(e.target.value))
                        }
                      >
                        <option value="">Unknown</option>
                        {["g", "kg", "ml", "l", "count"].map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </label>
                    <label className="span-two">
                      Comparison group
                      <input
                        aria-label={"Item " + (index + 1) + " comparison group"}
                        value={line.comparison_group}
                        onChange={(e) =>
                          updateLine(index, "comparison_group", e.target.value)
                        }
                      />
                      <span className="field-hint">
                        Only items in this group will be compared.
                      </span>
                    </label>
                  </div>
                  <details>
                    <summary>
                      Original text, discounts and advertised prices
                    </summary>
                    <div className="form-grid">
                      <label>
                        Original receipt text
                        <input
                          value={line.original_text}
                          onChange={(e) =>
                            updateLine(index, "original_text", e.target.value)
                          }
                        />
                      </label>
                      {[
                        ["discount", "Item discount"],
                        ["regular_price", "Regular price"],
                        ["sale_price", "Advertised sale price"],
                      ].map(([field, label]) => (
                        <label key={field}>
                          {label}
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={(line[field as keyof Line] as string) || ""}
                            placeholder="Unknown"
                            onChange={(e) =>
                              updateLine(
                                index,
                                field as keyof Line,
                                nullable(e.target.value),
                              )
                            }
                          />
                        </label>
                      ))}
                    </div>
                    <p className="small muted">
                      Line amount already includes known item discounts.
                    </p>
                  </details>
                </fieldset>
              ))}
            </section>
            {receipt.kind === "receipt" && (
              <section className="panel">
                <h2>Check the amounts</h2>
                <div className="form-grid">
                  {[
                    ["subtotal", "Subtotal"],
                    ["tax", "Tax"],
                    ["receipt_discount", "Receipt discount"],
                    ["fees", "Other fees"],
                    ["total", "Receipt total"],
                  ].map(([field, label]) => (
                    <label key={field}>
                      {label}
                      <input
                        aria-label={label}
                        type="number"
                        min={field === "receipt_discount" ? "0" : undefined}
                        step="0.01"
                        value={
                          (receipt[field as keyof Receipt] as string) || ""
                        }
                        placeholder="Unknown"
                        onChange={(e) =>
                          updateReceipt(
                            field as keyof Receipt,
                            nullable(e.target.value),
                          )
                        }
                      />
                    </label>
                  ))}
                </div>
                {issues.length > 0 ? (
                  <div
                    className="reconciliation warning"
                    data-testid="reconciliation"
                  >
                    <strong>Amounts need a second look</strong>
                    <ul>
                      {issues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={receipt.acknowledged_difference}
                        onChange={(e) =>
                          updateReceipt(
                            "acknowledged_difference",
                            e.target.checked,
                          )
                        }
                      />
                      I’ve checked and acknowledge the unresolved amounts.
                    </label>
                  </div>
                ) : (
                  <div
                    className="reconciliation balanced"
                    data-testid="reconciliation"
                  >
                    <Check size={18} />
                    The amounts balance.
                  </div>
                )}
              </section>
            )}
            <section className="panel">
              <label>
                Notes
                <textarea
                  rows={2}
                  value={receipt.notes || ""}
                  onChange={(e) =>
                    updateReceipt("notes", nullable(e.target.value))
                  }
                />
              </label>
            </section>
            {error && (
              <p role="alert" aria-label="Error" className="error">
                {error}
              </p>
            )}
            {saved && (
              <p role="status" className="success">
                {saved}
              </p>
            )}
            <div className="save-bar">
              {receipt.status !== "confirmed" && (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void save(false)}
                >
                  Save draft
                </button>
              )}
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void save(true)}
              >
                <Check size={18} />
                {busy
                  ? "Saving…"
                  : receipt.status === "confirmed"
                    ? "Save corrections"
                    : "Confirm receipt"}
              </button>
            </div>
          </section>
          <aside className="evidence-panel">
            <div className="section-heading">
              <h2>The original</h2>
              <span className="badge">PRIVATE</span>
            </div>
            {detail.file_url ? (
              receipt.mime_type === "application/pdf" ? (
                <a
                  className="button secondary"
                  href={detail.file_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open original PDF
                </a>
              ) : (
                <a href={detail.file_url} target="_blank" rel="noreferrer">
                  <img
                    src={detail.file_url}
                    alt="Original capture"
                    className="evidence-image"
                  />
                </a>
              )
            ) : (
              <p className="muted">Original file unavailable.</p>
            )}
            {receipt.uncertain_fields.length > 0 && (
              <div className="uncertainty">
                <h3>Please check</h3>
                <ul>
                  {receipt.uncertain_fields.map((field) => (
                    <li key={field}>{field}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="small muted">
              Confirmed item names are remembered for your next receipt from
              this store.
            </p>
          </aside>
        </div>
      )}
      {(processing || failed) && error && (
        <p role="alert" aria-label="Error" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
