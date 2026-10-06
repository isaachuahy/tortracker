"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShoppingBag, ArrowRight, LockKeyhole } from "lucide-react";
import { browserClient } from "@/lib/supabase-browser";
export default function Login() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const db = browserClient();
    const { error } = await db.auth.signInWithPassword({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    if (error) {
      setError("That email and password didn’t match. Please try again.");
      setBusy(false);
      return;
    }
    const initialized = await db.rpc("initialize_items");
    if (initialized.error) {
      setError(
        "Signed in, but your notebook could not be initialized. Please try again.",
      );
      setBusy(false);
      return;
    }
    router.replace("/capture");
    router.refresh();
  }
  return (
    <main className="login-page">
      <div className="login-art">
        <div className="brand">
          <ShoppingBag size={28} />
          <span>
            tortracker<span className="brand-dot">.</span>
          </span>
        </div>
        <div>
          <p className="eyebrow light">YOUR GROCERY NOTEBOOK</p>
          <h1>
            Little receipts.
            <br />A clearer picture.
          </h1>
          <p>
            Keep what you bought. See what you spent.
            <br />
            Find a better price around the corner.
          </p>
          <div className="login-tags">
            <span>Capture</span>
            <span>Spending</span>
            <span>Prices</span>
          </div>
        </div>
        <p className="login-location">Made for your Toronto grocery run.</p>
      </div>
      <section className="login-form">
        <div className="login-inner">
          <span className="icon-well">
            <LockKeyhole />
          </span>
          <p className="eyebrow">A PRIVATE SPACE</p>
          <h2>Welcome back.</h2>
          <p className="muted">Sign in to your own grocery notebook.</p>
          <form onSubmit={signIn}>
            <label>
              Email
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                minLength={8}
                required
              />
            </label>
            {error && (
              <p className="error" role="alert" aria-label="Error">
                {error}
              </p>
            )}
            <button className="button primary full" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
              <ArrowRight size={18} />
            </button>
          </form>
          <p className="small muted">
            Access is by invitation. Your receipts stay private.
          </p>
        </div>
      </section>
    </main>
  );
}
