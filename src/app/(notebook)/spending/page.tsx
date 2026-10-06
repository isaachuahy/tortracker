"use client";
import { useState } from "react";
import Link from "next/link";
import { Download, ArrowUpRight, ReceiptText, Search } from "lucide-react";
import Decimal from "decimal.js";
import { useWorkspace } from "@/lib/use-workspace";
import { money, sum, today } from "@/lib/money";
export default function Spending() {
  const { data, error } = useWorkspace();
  const [month, setMonth] = useState(today().slice(0, 7)),
    [search, setSearch] = useState("");
  const receipts =
    data?.receipts.filter(
      (r) =>
        r.status === "confirmed" &&
        r.kind === "receipt" &&
        r.purchase_date?.startsWith(month),
    ) || [];
  const receiptById = new Map(receipts.map((r) => [r.id, r]));
  const lines = data?.lines.filter((l) => receiptById.has(l.receipt_id!)) || [];
  const categories = new Map<string, (string | null)[]>();
  lines.forEach((l) =>
    categories.set(l.category, [
      ...(categories.get(l.category) || []),
      l.line_amount,
    ]),
  );
  const stores = new Map<string, string[]>();
  receipts.forEach((r) =>
    stores.set(r.store_name || "Unknown store", [
      ...(stores.get(r.store_name || "Unknown store") || []),
      r.total || "0",
    ]),
  );
  const total = sum(receipts.map((r) => r.total));
  const categoryTotals = [...categories]
    .map(([name, values]) => ({
      name,
      total: values.some((value) => value != null) ? sum(values) : null,
      unknown: values.filter((value) => value == null).length,
    }))
    .sort((a, b) => new Decimal(b.total || "0").cmp(a.total || "0"));
  const max = Decimal.max(1, ...categoryTotals.map((c) => c.total || "0"));
  const filtered = lines.filter((l) =>
    (l.item_name + " " + l.original_text)
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">THE BIGGER PICTURE</p>
          <h1>Know where it goes.</h1>
          <p className="muted">Your confirmed purchases, all in one place.</p>
        </div>
        <span className="page-number">02 / SPENDING</span>
      </div>
      <div className="toolbar">
        <label className="inline-label">
          Month
          <input
            aria-label="Spending month"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </label>
        <a className="button secondary" href="/api/export" download>
          <Download size={17} />
          Export CSV
        </a>
      </div>
      {error && (
        <p role="alert" aria-label="Error" className="error">
          {error}
        </p>
      )}
      <div className="stats-grid">
        <div className="stat featured">
          <span className="eyebrow">TOTAL SPENT</span>
          <strong data-testid="spending-total">{money(total)}</strong>
          <span>Including recorded tax and fees</span>
        </div>
        <div className="stat">
          <span className="eyebrow">GROCERY RUNS</span>
          <strong>{receipts.length}</strong>
          <span>Confirmed receipts this month</span>
        </div>
        <div className="stat">
          <span className="eyebrow">AVERAGE RUN</span>
          <strong>
            {receipts.length
              ? money(new Decimal(total).div(receipts.length).toFixed(2))
              : "—"}
          </strong>
          <span>A little context for your habits</span>
        </div>
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <div className="section-heading">
            <h2>By category</h2>
            <span className="small muted">Item amounts paid</span>
          </div>
          {categoryTotals.length ? (
            categoryTotals.map((c, index) => (
              <div className="category-row" key={c.name}>
                <div>
                  <span>
                    <i className={"category-dot color-" + (index % 5)} />
                    {c.name}
                  </span>
                  <strong>
                    {money(c.total)}
                    {c.total != null && c.unknown > 0 && " + unknown"}
                  </strong>
                </div>
                <div className="bar-track">
                  <div
                    className={"bar-fill color-" + (index % 5)}
                    style={{
                      width:
                        Decimal.max(0, c.total || "0")
                          .div(max)
                          .mul(100)
                          .toNumber() + "%",
                    }}
                  />
                </div>
              </div>
            ))
          ) : (
            <p className="muted">
              Categories appear after you confirm a receipt.
            </p>
          )}
          <p className="small muted">
            Tax, receipt-wide discounts and fees are shown in the total above.
            {categoryTotals.some((category) => category.unknown > 0) &&
              " Some item amounts are unknown; category totals include only recorded amounts."}
          </p>
        </section>
        <section className="panel">
          <h2>By store</h2>
          {stores.size ? (
            [...stores].map(([name, values]) => (
              <div className="store-total" key={name}>
                <span className="store-icon">
                  <ReceiptText size={17} />
                </span>
                <span>{name}</span>
                <strong>{money(sum(values))}</strong>
              </div>
            ))
          ) : (
            <p className="muted">Your next grocery run starts this list.</p>
          )}
        </section>
      </div>
      <section className="section">
        <div className="section-heading">
          <h2>
            The details <span className="count">{filtered.length}</span>
          </h2>
          <label className="search-box">
            <Search size={18} />
            <input
              aria-label="Search purchased items"
              placeholder="Search your items"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        {filtered.length === 0 ? (
          <div className="empty-state">
            <ReceiptText size={30} />
            <h3>
              {search ? "No matching items." : "A little history starts here."}
            </h3>
            <p>
              {search
                ? "Try another item name."
                : "Confirm a receipt to see spending for this month."}
            </p>
            {!search && (
              <Link className="button secondary" href="/capture">
                Capture a receipt
              </Link>
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Store & date</th>
                  <th>Category</th>
                  <th className="align-right">Paid</th>
                  <th>
                    <span className="visually-hidden">Receipt</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((line, index) => {
                  const receipt = receiptById.get(line.receipt_id!)!;
                  return (
                    <tr key={line.id || index}>
                      <td>
                        <strong>{line.item_name}</strong>
                        <span className="table-sub">{line.original_text}</span>
                      </td>
                      <td>
                        {receipt.store_name}
                        <span className="table-sub">
                          {receipt.purchase_date}
                        </span>
                      </td>
                      <td>
                        <span className="category-pill">{line.category}</span>
                      </td>
                      <td className="align-right">
                        <strong>{money(line.line_amount)}</strong>
                      </td>
                      <td>
                        <Link
                          aria-label={"Open receipt for " + line.item_name}
                          href={"/capture/" + receipt.id}
                        >
                          <ArrowUpRight size={17} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
