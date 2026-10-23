import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import Decimal from "decimal.js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } },
);
const password = "Tortracker-local-2026!";
const nonce = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const dateAt = (value: Date) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit",
}).format(value);

async function signIn(page: Page, email = `${test.info().project.name}@example.test`) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/capture$/);
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } },
  );
  const auth = await client.auth.signInWithPassword({ email, password });
  if (auth.error) throw auth.error;
  return { client, userId: auth.data.user!.id };
}

async function itemFor(userId: string) {
  const result = await admin.from("items").insert({
    user_id: userId,
    name: "Dashboard apples " + nonce(),
    category: "Produce",
    comparison_group: "Dashboard comparison " + nonce(),
  }).select("*").single();
  if (result.error) throw result.error;
  return result.data;
}

async function branches(page: Page) {
  const response = await page.request.get("/api/workspace");
  expect(response.ok()).toBeTruthy();
  return (await response.json()).stores as { id: string; name: string }[];
}

test("dashboard compares unit costs and keeps timed PC offers separate from cash", async ({ page }) => {
  const { userId, client } = await signIn(page);
  const item = await itemFor(userId);
  const stores = await branches(page);
  const now = Date.now(), hour = 3_600_000;
  const sourceId = "dashboard-" + nonce();
  const baseOffer = {
    item_id: item.id, branch_ids: [stores[0].id], price: "1.50",
    package_size: "500", unit: "g", regular_price: "3.00",
    valid_from: dateAt(new Date(now - hour)), valid_to: dateAt(new Date(now + 2 * hour)),
    starts_at: new Date(now - hour).toISOString(), ends_at: new Date(now + hour).toISOString(),
    source_url: "https://www.loblaws.ca/", channel: "in-store", conditions: "Active dashboard offer",
    source_provider: "e2e", source_id: sourceId, points: 1000, loyalty_program: "PC Optimum",
  };
  const observation = await page.request.post("/api/prices", {
    headers: { Origin: "http://127.0.0.1:3000" },
    data: {
      item_id: item.id, branch_id: stores[0].id, store_name: stores[0].name,
      observed_on: dateAt(new Date(now)), price: "3.00", package_size: "500", unit: "g",
      source_url: "https://www.loblaws.ca/", channel: "in-store", conditions: "Dashboard cost",
    },
  });
  expect(observation.ok()).toBeTruthy();
  const imported = await page.request.post("/api/offers", {
    headers: { Origin: "http://127.0.0.1:3000" },
    data: [
      baseOffer,
      { ...baseOffer, source_id: sourceId + "-future", conditions: "Upcoming dashboard offer",
        starts_at: new Date(now + hour).toISOString(), ends_at: new Date(now + 2 * hour).toISOString() },
      { ...baseOffer, source_id: sourceId + "-expired", conditions: "Expired dashboard offer",
        starts_at: new Date(now - 2 * hour).toISOString(), ends_at: new Date(now - hour).toISOString() },
      { ...baseOffer, source_id: sourceId + "-volume", price: "0.01", unit: "l", package_size: "1",
        conditions: "Different dimension", points: 0, loyalty_program: null },
    ],
  });
  expect(imported.status()).toBe(201);
  const repeat = await page.request.post("/api/offers", {
    headers: { Origin: "http://127.0.0.1:3000" },
    data: [{ ...baseOffer, price: "1.25", branch_ids: [stores[1].id, stores[1].id] }],
  });
  expect(repeat.status()).toBe(201);
  const records = await client.from("offers_read").select("id,price").eq("source_provider", "e2e").eq("source_id", sourceId);
  expect(records.error).toBeNull();
  expect(records.data).toHaveLength(1);
  expect(records.data![0].price).toBe("1.2500");
  const branchRecords = await client.from("offer_stores").select("branch_id").eq("offer_id", records.data![0].id);
  expect(branchRecords.data).toEqual([{ branch_id: stores[1].id }]);

  const costs = await client.from("item_unit_costs").select("*").eq("item_id", item.id).single();
  expect(costs.error).toBeNull();
  expect(typeof costs.data.comparable_unit_price).toBe("string");
  expect(new Decimal(costs.data.comparable_unit_price).eq(6)).toBeTruthy();
  expect(costs.data.comparable_unit).toBe("kg");

  await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByLabel("Search grocery items", { exact: true }).fill(item.name);
  const itemRow = page.getByTestId("grocery-item-row").filter({ hasText: item.name });
  await expect(itemRow).toContainText("$3.00");
  await expect(itemRow).toContainText("$6.00 / kg");
  await expect(itemRow).toContainText("$2.50 / kg");
  await expect(itemRow).toContainText("1,000 PC Optimum points");
  await expect(itemRow).not.toContainText("$0.01");
  const active = page.getByTestId("dashboard-sale-row").filter({ hasText: "Active dashboard offer" });
  await expect(active).toContainText("$1.25");
  await expect(active).toContainText("1,000 PC Optimum points");
  await expect(active.getByRole("link", { name: "Official source" })).toHaveAttribute("href", "https://www.loblaws.ca/");
  await page.getByRole("button", { name: /^Upcoming / }).click();
  await expect(page.getByTestId("dashboard-sale-row").filter({ hasText: "Upcoming dashboard offer" })).toBeVisible();
  await expect(active).toHaveCount(0);
  await page.getByRole("button", { name: /^Expired / }).click();
  await expect(page.getByTestId("dashboard-sale-row").filter({ hasText: "Expired dashboard offer" })).toBeVisible();
  await page.goto("/prices?item=" + encodeURIComponent(item.name));
  await expect(page.getByTestId("offer-card").filter({ hasText: "Active dashboard offer" })).toBeVisible();
  await expect(page.getByTestId("offer-card").filter({ hasText: "Active dashboard offer" })).toContainText("1,000 PC Optimum points");
  await expect(page.getByTestId("offer-card").filter({ hasText: "Expired dashboard offer" })).toHaveCount(0);
  await expect(page.getByTestId("offer-card").filter({ hasText: "Upcoming dashboard offer" })).toHaveCount(0);
  await page.getByRole("link", { name: "Sources", exact: true }).click();
  await expect(page).toHaveURL(/\/sources$/);
});

test("sale import rolls back invalid rows and keeps costs and source IDs private", async ({ page }) => {
  const { userId, client } = await signIn(page);
  const item = await itemFor(userId);
  const stores = await branches(page);
  const sourceId = "atomic-" + nonce();
  const offer = {
    item_id: item.id, branch_ids: [stores[0].id], price: "2.20", package_size: "1", unit: "kg",
    valid_from: "2026-01-01", valid_to: "2026-12-31", source_url: "https://www.metro.ca/",
    channel: "in-store", conditions: "Atomic rollback", source_provider: "e2e", source_id: sourceId,
  };
  const bad = await client.rpc("import_offers", {
    p_rows: [offer, { ...offer, source_id: sourceId + "-bad", starts_at: "2026-10-23T12:00:00Z", ends_at: "2026-10-23T12:00:00Z" }],
  });
  expect(bad.error).not.toBeNull();
  const absent = await client.from("offers_read").select("id").eq("source_id", sourceId);
  expect(absent.data).toEqual([]);

  const invalid = await page.request.post("/api/offers", {
    headers: { Origin: "http://127.0.0.1:3000" }, data: [{ ...offer, points: 1000 }],
  });
  expect(invalid.status()).toBe(400);
  const saved = await client.rpc("import_offers", { p_rows: [offer] });
  expect(saved.error).toBeNull();

  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  const other = await signIn(page, "other@example.test");
  const foreignCost = await other.client.from("item_unit_costs").select("*").eq("item_id", item.id);
  expect(foreignCost.data).toEqual([]);
  const foreignOffer = await other.client.from("offers_read").select("*").eq("source_id", sourceId);
  expect(foreignOffer.data).toEqual([]);
  const forbidden = await other.client.rpc("import_offers", { p_rows: [offer] });
  expect(forbidden.error).not.toBeNull();
  const otherItem = await itemFor(other.userId);
  const independent = await other.client.rpc("import_offers", { p_rows: [{ ...offer, item_id: otherItem.id }] });
  expect(independent.error).toBeNull();
  const all = await admin.from("offers").select("user_id").eq("source_provider", "e2e").eq("source_id", sourceId);
  expect(all.data).toHaveLength(2);
});

test("email evidence imports once and remains private with a service-only queue", async ({ page }) => {
  const { userId, client } = await signIn(page);
  const accountKey = "a".repeat(64), messageId = "email" + nonce().replace(/-/g, "");
  const path = `${userId}/email-${messageId}`;
  const uploaded = await admin.storage.from("receipts").upload(path,
    Buffer.from("Grocery receipt\nBananas $2.50\nSubtotal $2.50\nTax $0.00\nTotal $2.50\n"),
    { contentType: "text/plain", upsert: false },
  );
  expect(uploaded.error).toBeNull();
  const args = { p_user_id: userId, p_account_key: accountKey, p_message_id: messageId,
    p_part_key: "body", p_path: path, p_name: "Grocery receipt.txt", p_mime: "text/plain" };
  const unauthorized = await client.rpc("queue_email_receipt", args);
  expect(unauthorized.error).not.toBeNull();
  const first = await admin.rpc("queue_email_receipt", args);
  expect(first.error).toBeNull();
  const retry = await admin.rpc("queue_email_receipt", args);
  expect(retry.error).toBeNull();
  expect(retry.data).toBe(first.data);
  const imports = await client.from("email_imports").select("receipt_id,source_url").eq("message_id", messageId);
  expect(imports.error).toBeNull();
  expect(imports.data).toEqual([{ receipt_id: first.data, source_url: "https://mail.google.com/mail/u/0/#all/" + messageId }]);
  const jobs = await admin.from("jobs").select("id").eq("receipt_id", first.data);
  expect(jobs.data).toHaveLength(1);
  const wrongOwner = await admin.rpc("queue_email_receipt", { ...args, p_user_id: "00000000-0000-0000-0000-000000000000", p_message_id: messageId + "wrong" });
  expect(wrongOwner.error).not.toBeNull();

  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  const other = await signIn(page, "other@example.test");
  const privateImports = await other.client.from("email_imports").select("*").eq("message_id", messageId);
  expect(privateImports.data).toEqual([]);
  const privateFile = await other.client.storage.from("receipts").createSignedUrl(path, 60);
  expect(privateFile.error).not.toBeNull();
  expect((await page.request.get("/api/receipts/" + first.data)).status()).toBe(404);
});

test("source settings are owner scoped and an unconfigured flyer feed cannot claim a sync", async ({ page }) => {
  expect((await page.request.get("/api/sources")).status()).toBe(401);
  await signIn(page);
  const denied = await page.request.post("/api/sources", {
    headers: { Origin: "https://unrelated.example" }, data: { postal_code: "M5V 2T6" },
  });
  expect(denied.status()).toBe(403);
  const invalid = await page.request.post("/api/sources", {
    headers: { Origin: "http://127.0.0.1:3000" }, data: { postal_code: "invalid" },
  });
  expect(invalid.status()).toBe(400);
  const saved = await page.request.post("/api/sources", {
    headers: { Origin: "http://127.0.0.1:3000" }, data: { postal_code: "m5v 2t6" },
  });
  expect(saved.ok()).toBeTruthy();
  expect((await saved.json()).postal_code).toBe("M5V2T6");
  const sources = await page.request.get("/api/sources");
  expect(sources.headers()["cache-control"]).toBe("private, no-store");
  expect((await sources.json()).postal_code).toBe("M5V2T6");
  const feed = await page.request.get("/api/imports/flyers");
  expect(feed.ok()).toBeTruthy();
  expect(await feed.json()).toMatchObject({ configured: false });
  const before = await (await page.request.get("/api/workspace")).json();
  const sync = await page.request.post("/api/imports/flyers", {
    headers: { Origin: "http://127.0.0.1:3000" }, data: {},
  });
  expect(sync.status()).toBe(503);
  expect((await sync.json()).error).toBeTruthy();
  const after = await (await page.request.get("/api/workspace")).json();
  expect(after.offers).toEqual(before.offers);

  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await signIn(page, "other@example.test");
  const otherSources = await (await page.request.get("/api/sources")).json();
  expect(otherSources.postal_code).not.toBe("M5V2T6");
});

test("Sources imports PC offers from a CSV file, updates repeats, and rejects a bad batch atomically", async ({ page }) => {
  const { userId, client } = await signIn(page);
  const item = await itemFor(userId);
  const stores = await branches(page);
  const sourceId = "pc-source-" + nonce();
  const day = dateAt(new Date());
  const header = "item_name,store_branch,price,package_size,unit,valid_from,valid_to,source_url,channel,conditions,points,source_id";
  const csvRow = (price: string, id: string, name = item.name) => [
    name, stores[0].name, price, "2", "count", day, day,
    "https://www.pcoptimum.ca/", "in-store", "Buy two eligible items", "2000", id,
  ].map(value => '"' + value.replaceAll('"', '""') + '"').join(",");
  await page.goto("/sources");
  await expect(page.getByRole("button", { name: "Refresh flyers", exact: true })).toBeDisabled();
  await expect(page.getByText("Feed not configured", { exact: true })).toBeVisible();
  await expect(page.getByText("Not configured", { exact: true })).toBeVisible();
  await page.getByLabel("Canadian postal code", { exact: true }).fill("M5V 2T6");
  await page.getByRole("button", { name: "Save location", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Location saved" })).toBeVisible();
  await page.getByLabel("Offer source", { exact: true }).selectOption("pc-optimum");
  await page.getByLabel("Upload offers file", { exact: true }).setInputFiles({
    name: "pc-offers.csv", mimeType: "text/csv", buffer: Buffer.from(header + "\n" + csvRow("4.00", sourceId)),
  });
  await expect(page.getByLabel("Offer import data", { exact: true })).toHaveValue(new RegExp(sourceId));
  await page.getByRole("button", { name: "Save imported offers", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "1 offers saved" })).toBeVisible();
  await page.getByLabel("Offer import data", { exact: true }).fill(header + "\n" + csvRow("3.50", sourceId));
  await page.getByRole("button", { name: "Save imported offers", exact: true }).click();
  await expect(page.getByLabel("Offer import data", { exact: true })).toHaveValue("");
  const saved = await client.from("offers_read").select("id,price,points,loyalty_program")
    .like("source_provider", "manual-pc-optimum:%").eq("source_id", sourceId);
  expect(saved.error).toBeNull();
  expect(saved.data).toHaveLength(1);
  expect(saved.data![0]).toMatchObject({ price: "3.5000", points: 2000, loyalty_program: "PC Optimum" });
  await page.getByLabel("Offer import data", { exact: true }).fill(header + "\n" +
    csvRow("2.00", sourceId) + "\n" + csvRow("1.00", sourceId + "-bad", "Unknown product " + nonce()));
  await page.getByRole("button", { name: "Save imported offers", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(/unknown item/i);
  const retained = await client.from("offers_read").select("price").eq("id", saved.data![0].id).single();
  expect(retained.data?.price).toBe("3.5000");
  const otherRetailer = await page.request.post("/api/imports/offers?provider=pc-optimum", {
    headers: { Origin: "http://127.0.0.1:3000", "Content-Type": "application/json" },
    data: [{ item_name: item.name, store_branch: stores[1].name, price: "7.00", package_size: "2", unit: "count",
      valid_from: day, valid_to: day, source_url: "https://www.metro.ca/", channel: "in-store",
      conditions: "Another retailer", points: 500, source_id: sourceId }],
  });
  expect(otherRetailer.status()).toBe(201);
  const separateRetailers = await client.from("offers_read").select("id,source_provider,price").eq("source_id", sourceId);
  expect(separateRetailers.data).toHaveLength(2);
  expect(new Set(separateRetailers.data!.map(offer => offer.source_provider)).size).toBe(2);
  expect(separateRetailers.data!.map(offer => offer.price).sort()).toEqual(["3.5000", "7.0000"]);
  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  const sale = page.getByTestId("dashboard-sale-row").filter({ hasText: item.name }).filter({ hasText: "Buy two eligible items" });
  await expect(sale).toContainText("$3.50");
  await expect(sale).toContainText("$1.75 / each");
  await expect(sale).toContainText("2,000 PC Optimum points");
  await expect(sale).toContainText("Buy two eligible items");
});
