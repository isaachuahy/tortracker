"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  Camera,
  FileText,
  Upload,
  Check,
  ScanLine,
  ArrowRight,
} from "lucide-react";
import { useWorkspace, request } from "@/lib/use-workspace";
import { money } from "@/lib/money";
export default function Capture() {
  const { data, error, refresh } = useWorkspace(),
    router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null),
    cameraInput = useRef<HTMLInputElement>(null);
  const pending = useRef<{ file: File; id: string } | null>(null);
  const [kind, setKind] = useState<"receipt" | "shelf">("receipt"),
    [busy, setBusy] = useState(false),
    [uploadError, setUploadError] = useState("");
  useEffect(() => {
    if (
      !data?.receipts.some(
        (r) => r.status === "queued" || r.status === "processing",
      )
    )
      return;
    const timer = setInterval(() => void refresh(), 1500);
    return () => clearInterval(timer);
  }, [data, refresh]);
  async function upload(file?: File, retry = false) {
    if (!file) return;
    if (!retry || !pending.current)
      pending.current = { file, id: crypto.randomUUID() };
    setBusy(true);
    setUploadError("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("kind", kind);
      form.set("capture_id", pending.current.id);
      const result = await request<{ id: string }>("/api/capture", {
        method: "POST",
        body: form,
      });
      router.push("/capture/" + result.id);
    } catch (error) {
      setUploadError(
        error instanceof TypeError
          ? "The upload could not be confirmed. Please try again."
          : error instanceof Error
            ? error.message
            : "Upload failed.",
      );
      setBusy(false);
    }
  }
  const pendingCount =
    data?.receipts.filter((r) => r.status !== "confirmed").length || 0;
  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ONE LESS THING TO KEEP TRACK OF</p>
          <h1>From receipt to record.</h1>
          <p className="muted">A quick photo now. A clearer picture later.</p>
        </div>
        <span className="page-number">01 / CAPTURE</span>
      </div>
      <section className="capture-grid">
        <div className="capture-card">
          <div className="capture-top">
            <span className="icon-well">
              <ScanLine size={23} />
            </span>
            <span className="badge">PRIVATE BY DEFAULT</span>
          </div>
          <h2>Start with a photo.</h2>
          <p>
            We’ll pull out the details.
            <br />
            You get the final say.
          </p>
          <div className="segmented" aria-label="Document type">
            <button
              aria-pressed={kind === "receipt"}
              className={kind === "receipt" ? "selected" : ""}
              onClick={() => setKind("receipt")}
            >
              Receipt
            </button>
            <button
              aria-pressed={kind === "shelf"}
              className={kind === "shelf" ? "selected" : ""}
              onClick={() => setKind("shelf")}
            >
              Shelf label
            </button>
          </div>
          <div className="capture-actions">
            <button
              className="button primary"
              onClick={() => cameraInput.current?.click()}
              disabled={busy}
            >
              <Camera size={18} />
              {busy ? "Uploading…" : "Take a photo"}
            </button>
            <button
              className="button secondary"
              onClick={() => fileInput.current?.click()}
              disabled={busy}
            >
              <Upload size={18} />
              Upload a file
            </button>
          </div>
          <input
            ref={fileInput}
            aria-label="Upload receipt file"
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="visually-hidden"
            onChange={(e) => void upload(e.target.files?.[0])}
          />
          <input
            ref={cameraInput}
            aria-label="Take receipt photo"
            type="file"
            accept="image/*"
            capture="environment"
            className="visually-hidden"
            onChange={(e) => void upload(e.target.files?.[0])}
          />
          <p className="small muted">JPG, PNG, WebP or PDF · up to 10 MB</p>
          {uploadError && (
            <>
              <p role="alert" aria-label="Error" className="error">
                {uploadError}
              </p>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void upload(pending.current?.file, true)}
              >
                Retry upload
              </button>
            </>
          )}
        </div>
        <div className="how-card">
          <p className="eyebrow">A LITTLE LESS MANUAL WORK</p>
          <h2>Three small steps.</h2>
          {[
            ["01", "Capture", "Photograph a receipt or shelf label."],
            ["02", "Review", "Check the details. Fix anything uncertain."],
            ["03", "Keep", "Confirm it. Your notebook does the rest."],
          ].map(([n, title, text]) => (
            <div className="how-step" key={n}>
              <span>{n}</span>
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
              {n === "03" && <Check size={18} />}
            </div>
          ))}
          <p className="how-note">
            Processing keeps going after you close the browser.
          </p>
        </div>
      </section>
      <section className="section">
        <div className="section-heading">
          <h2>
            Your recent captures{" "}
            <span className="count">{data?.receipts.length || 0}</span>
          </h2>
          <span className="small muted">
            {pendingCount ? pendingCount + " to review" : "All caught up"}
          </span>
        </div>
        {error && (
          <p role="alert" aria-label="Error" className="error">
            {error}
          </p>
        )}
        {!data && !error && <p className="loading">Loading your notebook…</p>}
        {data && data.receipts.length === 0 && (
          <div className="empty-state">
            <FileText size={30} />
            <h3>A fresh page.</h3>
            <p>
              Your first receipt will appear here. Start with a photo or file
              above.
            </p>
          </div>
        )}
        <div className="receipt-list">
          {data?.receipts.map((r) => (
            <Link className="receipt-row" href={"/capture/" + r.id} key={r.id}>
              <span
                className={
                  "receipt-icon " + (r.status === "confirmed" ? "done" : "")
                }
              >
                <FileText size={22} />
              </span>
              <span className="receipt-info">
                <strong>{r.store_name || r.file_name}</strong>
                <span>
                  {r.kind === "shelf" ? "Shelf label" : "Receipt"} ·{" "}
                  {r.purchase_date || "Date to review"}
                </span>
              </span>
              <span className={"status " + r.status}>
                {r.status === "review"
                  ? "Ready to review"
                  : r.status === "queued"
                    ? "Queued"
                    : r.status === "processing"
                      ? "Processing"
                      : r.status === "failed"
                        ? "Needs a retry"
                        : "Confirmed"}
              </span>
              <strong className="receipt-amount">{money(r.total)}</strong>
              <ArrowUpRight size={18} />
            </Link>
          ))}
        </div>
      </section>
      <div className="quiet-link">
        <span>Already have a price in mind?</span>
        <Link href="/prices">
          Add a price observation <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  );
}
