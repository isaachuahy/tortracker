import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false },
});
const password = "Tortracker-local-2026!";
const origin = "http://127.0.0.1:3000";
const nonce = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const sourceUrl = "https://www.pcoptimum.ca/";

async function signIn(page: Page, email = `${test.info().project.name}@example.test`) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/capture$/);
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false },
  });
  const auth = await client.auth.signInWithPassword({ email, password });
  if (auth.error) throw auth.error;
  return { client, userId: auth.data.user!.id };
}

function offer(sourceId: string, observedAt = new Date().toISOString()) {
  return {
    source_id: sourceId, title: "Personal reward " + sourceId, scope: "basket", points: 1000,
    minimum_spend: "75.00", terms: "Spend $75 on eligible groceries before tax. Exclusions apply.",
    source_url: sourceUrl, observed_at: observedAt,
  };
}

function transaction(sourceId: string, observedAt = new Date().toISOString()) {
  return {
    source_id: sourceId, occurred_at: observedAt, observed_at: observedAt,
    points_delta: 1000, type: "earned", description: "Recorded points " + sourceId,
    merchant: "Loblaws", source_url: sourceUrl,
  };
}

function cashRecords(data: {
  receipts: { id: string; status: string; total: string | null }[];
  observations: unknown[];
  offers: unknown[];
}) {
  return {
    confirmed: data.receipts.filter(receipt => receipt.status === "confirmed")
      .map(({ id, total }) => ({ id, total })).sort((a, b) => a.id.localeCompare(b.id)),
    observations: data.observations,
    offers: data.offers,
  };
}

test("reviewed PC import keeps points-only and basket rewards apart from cash spending", async ({ page }) => {
  await signIn(page);
  const tag = "ui-" + nonce(), now = Date.now();
  const observed = new Date(now).toISOString();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(now));
  const data = {
    offers: [
      { ...offer(tag + "-item", observed), title: "Points-only apples " + tag, scope: "item",
        minimum_spend: null, minimum_quantity: 2, points: 800, activation_state: "active",
        terms: "Earn 800 points when you buy two eligible apple packages. Offer dates were not shown." },
      { ...offer(tag + "-basket", observed), title: "Basket multiplier " + tag, points: null,
        points_multiplier: "20", activation_state: "available",
        starts_at: new Date(now - 3_600_000).toISOString(), ends_at: new Date(now + 3_600_000).toISOString() },
      { ...offer(tag + "-expiry", observed), title: "Expiry-only reward " + tag, scope: "category",
        valid_to: today, minimum_spend: null },
      { ...offer(tag + "-start", observed), title: "Start-only reward " + tag,
        starts_at: new Date(now + 3_600_000).toISOString() },
      { ...offer(tag + "-expired", observed), title: "Expired-only reward " + tag,
        ends_at: new Date(now - 3_600_000).toISOString() },
    ],
    transactions: [
      { ...transaction(tag + "-earned", observed), points_delta: 3000, description: "Earned entry " + tag },
      { ...transaction(tag + "-redeemed", observed), points_delta: -1000, type: "redeemed", description: "Redeemed entry " + tag },
      { ...transaction(tag + "-adjusted", observed), points_delta: -50, type: "adjustment", description: "Adjustment entry " + tag },
    ],
  };
  const before = cashRecords(await (await page.request.get("/api/workspace")).json());
  await page.goto("/dashboard");
  await expect(page.getByTestId("dashboard-spending")).toBeVisible();
  const spendingBefore = await page.getByTestId("dashboard-spending").textContent();
  await page.goto("/loyalty");
  const save = page.getByRole("button", { name: "Save reviewed records", exact: true });
  const editor = page.getByLabel("PC Optimum import JSON", { exact: true });
  await expect(save).toBeDisabled();
  await editor.fill(JSON.stringify(data));
  await page.getByRole("button", { name: "Review imported JSON", exact: true }).click();
  await expect(save).toBeEnabled();
  await editor.fill(JSON.stringify(data, null, 2));
  await expect(save).toBeDisabled();
  await page.getByRole("button", { name: "Review imported JSON", exact: true }).click();
  await save.click();
  await expect(page.locator("#loyalty-import").getByRole("status")).toContainText("Saved 5 offers and 3 transactions");

  const pointsOnly = page.getByTestId("loyalty-offer-card").filter({ hasText: "Points-only apples " + tag });
  await expect(pointsOnly).toContainText("800 points");
  await expect(pointsOnly).toContainText("Buy at least 2 qualifying items");
  await expect(pointsOnly).toContainText("Validity unknown");
  await expect(pointsOnly).toContainText("Loaded");
  await expect(pointsOnly).not.toContainText("$");
  const basket = page.getByTestId("loyalty-offer-card").filter({ hasText: "Basket multiplier " + tag });
  await expect(basket).toContainText(/20(?:\.0+)?× points/);
  await expect(basket).toContainText("Spend at least $75.00");
  await expect(basket).toContainText("Current dates");
  await expect(basket.getByRole("link", { name: "View source" })).toHaveAttribute("href", sourceUrl);
  await page.getByLabel("Filter offer scope", { exact: true }).selectOption("basket");
  await expect(basket).toBeVisible();
  await expect(pointsOnly).toHaveCount(0);
  await page.getByLabel("Filter offer scope", { exact: true }).selectOption("all");
  await page.getByLabel("Filter offer validity", { exact: true }).selectOption("unknown");
  await expect(pointsOnly).toBeVisible();
  await expect(basket).toHaveCount(0);
  const expiryOnly = page.getByTestId("loyalty-offer-card").filter({ hasText: "Expiry-only reward " + tag });
  await expect(expiryOnly).toContainText("Validity unknown");
  await expect(expiryOnly).toContainText("Start unknown");
  await expect(expiryOnly).toContainText(today);
  await expect(expiryOnly).toContainText("end of day");
  await page.getByLabel("Filter offer validity", { exact: true }).selectOption("upcoming");
  await expect(page.getByTestId("loyalty-offer-card").filter({ hasText: "Start-only reward " + tag })).toContainText("Upcoming");
  await page.getByLabel("Filter offer validity", { exact: true }).selectOption("expired");
  await expect(page.getByTestId("loyalty-offer-card").filter({ hasText: "Expired-only reward " + tag })).toContainText("Expired");
  await expect(page.getByTestId("loyalty-transaction-row").filter({ hasText: "Earned entry " + tag })).toContainText("+3,000");
  await expect(page.getByTestId("loyalty-transaction-row").filter({ hasText: "Redeemed entry " + tag })).toContainText("-1,000");
  await expect(page.getByTestId("loyalty-transaction-row").filter({ hasText: "Adjustment entry " + tag })).toContainText("-50");
  await expect(page.getByText("Imported history, not an account balance", { exact: true })).toBeVisible();
  expect(cashRecords(await (await page.request.get("/api/workspace")).json())).toEqual(before);
  await page.goto("/dashboard");
  await expect(page.getByTestId("dashboard-spending")).toHaveText(spendingBefore!);
});

test("loyalty retries retain identities, stale observations are ignored, and mixed batches roll back", async ({ page }) => {
  const { client } = await signIn(page);
  const tag = "retry-" + nonce(), now = Date.now();
  const original = new Date(now).toISOString();
  const newer = new Date(now + 1000).toISOString(), stale = new Date(now - 1000).toISOString();
  const payload = { offers: [offer(tag, original)], transactions: [transaction(tag, original)] };
  for (let attempt = 0; attempt < 2; attempt++) {
    const saved = await page.request.post("/api/loyalty", { headers: { Origin: origin }, data: payload });
    expect(saved.status()).toBe(201);
    expect(await saved.json()).toEqual({ offers: 1, transactions: 1 });
  }
  const firstOffer = await client.from("loyalty_offers_read").select("*").eq("source_id", tag);
  const firstTransaction = await client.from("loyalty_transactions_read").select("*").eq("source_id", tag);
  expect(firstOffer.data).toHaveLength(1);
  expect(firstTransaction.data).toHaveLength(1);
  const updated = await page.request.post("/api/loyalty", {
    headers: { Origin: origin }, data: {
      offers: [{ ...offer(tag, newer), points: 1500 }],
      transactions: [{ ...transaction(tag, newer), points_delta: 2000 }],
    },
  });
  expect(updated.status()).toBe(201);
  const older = await page.request.post("/api/loyalty", {
    headers: { Origin: origin }, data: {
      offers: [{ ...offer(tag, stale), points: 1 }],
      transactions: [{ ...transaction(tag, stale), points_delta: 1 }],
    },
  });
  expect(await older.json()).toEqual({ offers: 0, transactions: 0 });
  const retainedOffer = await client.from("loyalty_offers_read").select("id,points").eq("source_id", tag).single();
  const retainedTransaction = await client.from("loyalty_transactions_read").select("id,points_delta").eq("source_id", tag).single();
  expect(retainedOffer.data).toEqual({ id: firstOffer.data![0].id, points: 1500 });
  expect(retainedTransaction.data).toEqual({ id: firstTransaction.data![0].id, points_delta: 2000 });

  // Reach the transaction loop after a valid offer write, then fail its sign constraint.
  const badBatch = await client.rpc("import_loyalty", { p_data: {
    offers: [offer(tag + "-rollback")],
    transactions: [{ ...transaction(tag + "-bad"), type: "redeemed", points_delta: 1000 }],
  } });
  expect(badBatch.error).not.toBeNull();
  expect((await client.from("loyalty_offers_read").select("id").eq("source_id", tag + "-rollback")).data).toEqual([]);
  const cashField = await page.request.post("/api/loyalty", {
    headers: { Origin: origin }, data: { offers: [{ ...offer(tag + "-price"), price: "0.00" }] },
  });
  expect(cashField.status()).toBe(400);
  const duplicateIds = await page.request.post("/api/loyalty", {
    headers: { Origin: origin }, data: { offers: [offer(tag + "-duplicate"), offer(tag + "-duplicate")] },
  });
  expect(duplicateIds.status()).toBe(400);
  const tooLarge = await page.request.post("/api/loyalty", {
    headers: { Origin: origin, "Content-Type": "application/json" }, data: " ".repeat(2 * 1024 * 1024 + 1),
  });
  expect(tooLarge.status()).toBe(413);
});

test("loyalty imports require authentication and protect both rows and linked records", async ({ page }) => {
  expect((await page.request.get("/api/loyalty")).status()).toBe(401);
  const owner = await signIn(page);
  const tag = "private-" + nonce();
  const item = await admin.from("items").insert({ user_id: owner.userId, name: "Loyalty item " + tag,
    category: "Produce", comparison_group: tag }).select("id").single();
  if (item.error) throw item.error;
  const receipt = await admin.from("receipts").insert({ user_id: owner.userId, kind: "receipt", status: "review",
    file_path: owner.userId + "/" + tag, file_name: "loyalty-fixture.txt", mime_type: "text/plain" }).select("id").single();
  if (receipt.error) throw receipt.error;
  const saved = await page.request.post("/api/loyalty", { headers: { Origin: origin }, data: {
    offers: [{ ...offer(tag), item_id: item.data.id }],
    transactions: [{ ...transaction(tag), receipt_id: receipt.data.id }],
  } });
  expect(saved.status()).toBe(201);
  const deniedOrigin = await page.request.post("/api/loyalty", {
    headers: { Origin: "https://unrelated.example" }, data: { offers: [offer(tag + "-origin")] },
  });
  expect(deniedOrigin.status()).toBe(403);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  const other = await signIn(page, "other@example.test");
  const response = await page.request.get("/api/loyalty");
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  const visible = await response.json();
  expect(visible.offers.some((row: { source_id: string }) => row.source_id === tag)).toBeFalsy();
  expect(visible.transactions.some((row: { source_id: string }) => row.source_id === tag)).toBeFalsy();
  expect((await other.client.from("loyalty_offers_read").select("*").eq("source_id", tag)).data).toEqual([]);
  expect((await other.client.from("loyalty_transactions_read").select("*").eq("source_id", tag)).data).toEqual([]);
  const foreignItem = await page.request.post("/api/loyalty", {
    headers: { Origin: origin }, data: { offers: [{ ...offer(tag), item_id: item.data.id }] },
  });
  expect(foreignItem.status()).toBe(409);
  const foreignReceipt = await page.request.post("/api/loyalty", {
    headers: { Origin: origin }, data: { transactions: [{ ...transaction(tag), receipt_id: receipt.data.id }] },
  });
  expect(foreignReceipt.status()).toBe(409);
  const directWrite = await other.client.from("loyalty_offers").insert({ ...offer(tag), user_id: owner.userId });
  expect(directWrite.error).not.toBeNull();
  const independent = await page.request.post("/api/loyalty", {
    headers: { Origin: origin }, data: { offers: [offer(tag)], transactions: [transaction(tag)] },
  });
  expect(independent.status()).toBe(201);
  expect((await admin.from("loyalty_offers").select("id").eq("source_id", tag)).data).toHaveLength(2);
  expect((await admin.from("loyalty_transactions").select("id").eq("source_id", tag)).data).toHaveLength(2);
});
