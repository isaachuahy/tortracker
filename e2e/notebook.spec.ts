import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import Decimal from "decimal.js";
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const password = "Tortracker-local-2026!";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/wAAAABJRU5ErkJggg==",
  "base64",
);
const nonce = () => Date.now() + "-" + Math.random().toString(16).slice(2);
async function login(
  page: Page,
  email = test.info().project.name + "@example.test",
) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/capture$/);
}
async function capture(page: Page, scenario = "receipt") {
  await page.goto("/capture");
  await page.getByLabel("Upload receipt file").setInputFiles({
    name: scenario + "-" + nonce() + ".png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(page).toHaveURL(/\/capture\/[0-9a-f-]+$/);
  return page.url().split("/").at(-1)!;
}
async function ready(page: Page) {
  await expect(page.getByLabel("Item 1 name", { exact: true })).toBeVisible({
    timeout: 45000,
  });
}
async function confirm(page: Page) {
  await page
    .getByLabel("Store branch", { exact: true })
    .selectOption({ label: "Loblaws Queen West · 585 Queen St W" });
  await page
    .getByRole("button", { name: "Confirm receipt", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Receipt confirmed");
}
async function workspace(page: Page) {
  return (await page.request.get("/api/workspace")).json();
}
async function observationCount(id: string) {
  const result = await admin
    .from("observations")
    .select("id", { count: "exact" })
    .eq("receipt_id", id);
  if (result.error) throw result.error;
  return result.count;
}
async function addPrice(
  page: Page,
  options: {
    store?: string;
    branch?: string;
    channel: string;
    price: string;
    size?: string;
    unit?: string;
    condition: string;
  },
) {
  await page.getByRole("button", { name: "Add a price", exact: true }).click();
  await page
    .getByLabel("Price item", { exact: true })
    .selectOption({ label: "Bananas" });
  if (options.branch)
    await page
      .getByLabel("Price branch", { exact: true })
      .selectOption({ label: options.branch });
  else
    await page
      .getByLabel("Price store name", { exact: true })
      .fill(options.store!);
  await page.getByLabel("Package price", { exact: true }).fill(options.price);
  if (options.size)
    await page
      .getByLabel("Price package size", { exact: true })
      .fill(options.size);
  if (options.unit)
    await page
      .getByLabel("Price size unit", { exact: true })
      .selectOption(options.unit);
  await page
    .getByLabel("Price channel", { exact: true })
    .selectOption(options.channel);
  await page
    .getByLabel("Source URL", { exact: true })
    .fill("https://www.metro.ca/");
  await page
    .getByLabel("Purchase conditions", { exact: true })
    .fill(options.condition);
  await page.getByRole("button", { name: "Save price", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Price observation saved",
  );
}

test("private sign-in and mobile navigation work", async ({ page }) => {
  const outsider = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  const signup = await outsider.auth.signUp({
    email: "uninvited-" + nonce() + "@example.test",
    password,
  });
  expect(signup.error).not.toBeNull();
  await page.goto("/spending");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Email", { exact: true }).fill("nobody@example.test");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("alert", { name: "Error", exact: true }),
  ).toContainText("didn’t match");
  await login(page);
  await page.getByRole("link", { name: "Spending", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Know where it goes." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Prices", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A little price perspective." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Capture", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("PDF uploads preserve private evidence and produce editable receipts", async ({
  page,
}) => {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    "<< /Length 48 >>\nstream\nBT /F1 12 Tf 30 260 Td (BANANA 500G 2.50) Tj ET\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += index + 1 + " 0 obj\n" + object + "\nendobj\n";
  });
  const xref = Buffer.byteLength(pdf);
  pdf +=
    "xref\n0 6\n0000000000 65535 f \n" +
    offsets
      .slice(1)
      .map((offset) => String(offset).padStart(10, "0") + " 00000 n \n")
      .join("") +
    "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" +
    xref +
    "\n%%EOF\n";
  await login(page);
  await page.getByLabel("Upload receipt file").setInputFiles({
    name: "pdf-" + nonce() + ".pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(pdf),
  });
  await expect(page).toHaveURL(/\/capture\/[0-9a-f-]+$/);
  await ready(page);
  const link = page.getByRole("link", {
    name: "Open original PDF",
    exact: true,
  });
  await expect(link).toBeVisible();
  const original = await page.request.get((await link.getAttribute("href"))!);
  expect(original.ok()).toBe(true);
  expect(original.headers()["content-type"]).toContain("application/pdf");
  expect((await original.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await confirm(page);
});

test("manual flyer entry retains branch applicability, conditions and source", async ({
  page,
}) => {
  await login(page);
  await page.goto("/prices?item=Bananas");
  await page
    .getByRole("button", { name: "Add flyer offer", exact: true })
    .click();
  await page
    .getByLabel("Price item", { exact: true })
    .selectOption({ label: "Bananas" });
  await page.getByLabel("Metro College Park", { exact: true }).check();
  await page.getByLabel("Package price", { exact: true }).fill("1.75");
  await page.getByLabel("Price package size", { exact: true }).fill("500");
  await page.getByLabel("Price size unit", { exact: true }).selectOption("g");
  await page
    .getByLabel("Source URL", { exact: true })
    .fill("https://www.metro.ca/");
  const condition = "Members only · " + nonce();
  await page.getByLabel("Purchase conditions", { exact: true }).fill(condition);
  await page.getByRole("button", { name: "Save offer", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Flyer offers saved");
  const card = page.getByTestId("offer-card").filter({ hasText: condition });
  await expect(card).toContainText("Metro College Park");
  await expect(card).toContainText("$3.50 / kg");
  await expect(
    card.getByRole("link", { name: "Official source", exact: true }),
  ).toHaveAttribute("href", "https://www.metro.ca/");
});

test("upload continues with all browser pages closed; confirmation feeds spending and CSV", async ({
  page,
  context,
}) => {
  await login(page);
  const before = await workspace(page);
  const baseline = before.receipts
    .filter(
      (r: { status: string; kind: string; purchase_date: string }) =>
        r.status === "confirmed" &&
        r.kind === "receipt" &&
        r.purchase_date?.startsWith("2026-10"),
    )
    .reduce(
      (sum: Decimal, r: { total: string }) => sum.add(r.total),
      new Decimal(0),
    );
  const id = await capture(page, "receipt");
  await page.close();
  await expect
    .poll(
      async () =>
        (await admin.from("receipts").select("status").eq("id", id).single())
          .data?.status,
      { timeout: 45000 },
    )
    .toBe("review");
  const reopened = await context.newPage();
  await reopened.goto("/capture/" + id);
  await ready(reopened);
  await expect(reopened.getByTestId("reconciliation")).toContainText(
    "The amounts balance",
  );
  await confirm(reopened);
  await reopened.goto("/spending");
  await reopened.getByLabel("Spending month", { exact: true }).fill("2026-10");
  await expect(reopened.getByTestId("spending-total")).toHaveText(
    "$" + baseline.add("2.50").toFixed(2),
  );
  await reopened.getByLabel("Search purchased items").fill("BANANA");
  await expect(reopened.getByRole("table")).toContainText("BANANA 500G");
  const downloadPromise = reopened.waitForEvent("download");
  await reopened.getByRole("link", { name: "Export CSV", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("tortracker-spending.csv");
  const csv = await readFile((await download.path())!, "utf8");
  expect(csv).toContain("BANANA 500G");
  expect(csv).toContain('"2.50"');
});

test("financial review uses exact decimals and corrected totals update derived prices", async ({
  page,
}) => {
  await login(page);
  const id = await capture(page, "difference");
  await ready(page);
  await expect(page.getByTestId("reconciliation")).toContainText(
    "differ from the total",
  );
  await page
    .getByRole("button", { name: "Confirm receipt", exact: true })
    .click();
  await expect(
    page.getByRole("alert", { name: "Error", exact: true }),
  ).toContainText("Resolve or acknowledge");
  await page.getByLabel("Receipt total", { exact: true }).fill("2.50");
  await confirm(page);
  await expect.poll(() => observationCount(id)).toBe(1);
  await page.getByLabel("Item 1 amount", { exact: true }).fill("0.10");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await page
    .getByLabel("Item 2 name", { exact: true })
    .fill("Decimal test item");
  await page.getByLabel("Item 2 quantity", { exact: true }).fill("1");
  await page.getByLabel("Item 2 amount", { exact: true }).fill("0.20");
  await page.getByLabel("Subtotal", { exact: true }).fill("0.30");
  await page.getByLabel("Receipt total", { exact: true }).fill("0.30");
  await expect(page.getByTestId("reconciliation")).toContainText(
    "The amounts balance",
  );
  await page
    .getByRole("button", { name: "Save corrections", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Receipt confirmed");
  const detail = await (await page.request.get("/api/receipts/" + id)).json();
  expect(detail.receipt.total).toBe("0.30");
  const result = await admin
    .from("observations_read")
    .select("price")
    .eq("receipt_id", id)
    .order("price");
  expect(result.data?.map((r) => r.price)).toEqual(["0.1000", "0.2000"]);
  await page.goto("/spending");
  await page.getByLabel("Spending month").fill("2026-10");
  const data = await workspace(page);
  const total = data.receipts
    .filter(
      (r: { kind: string; status: string; purchase_date: string }) =>
        r.kind === "receipt" &&
        r.status === "confirmed" &&
        r.purchase_date?.startsWith("2026-10"),
    )
    .reduce(
      (sum: Decimal, r: { total: string }) => sum.add(r.total),
      new Decimal(0),
    );
  await expect(page.getByTestId("spending-total")).toHaveText(
    "$" + total.toFixed(2),
  );
});

test("a lost upload response can be retried without duplicating the capture", async ({
  page,
}) => {
  await login(page);
  const before = (await workspace(page)).receipts.length;
  let acceptedId = "";
  await page.route(
    "**/api/capture",
    async (route) => {
      const response = await route.fetch();
      acceptedId = (await response.json()).id;
      await route.abort("failed");
    },
    { times: 1 },
  );
  await page.getByLabel("Upload receipt file").setInputFiles({
    name: "receipt-" + nonce() + ".png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(
    page.getByRole("button", { name: "Retry upload", exact: true }),
  ).toBeVisible();
  expect(acceptedId).not.toBe("");
  await page.getByRole("button", { name: "Retry upload", exact: true }).click();
  await expect(page).toHaveURL(new RegExp("/capture/" + acceptedId + "$"));
  await ready(page);
  expect((await workspace(page)).receipts.length).toBe(before + 1);
});

test("failed extraction can be retried through the UI without duplicate purchases", async ({
  page,
}) => {
  await login(page);
  const id = await capture(page, "retry");
  await expect(
    page.getByRole("button", { name: "Retry processing", exact: true }),
  ).toBeVisible({ timeout: 45000 });
  await page
    .getByRole("button", { name: "Retry processing", exact: true })
    .click();
  await ready(page);
  await confirm(page);
  await expect.poll(() => observationCount(id)).toBe(1);
  await page
    .getByRole("button", { name: "Save corrections", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Receipt confirmed");
  expect(await observationCount(id)).toBe(1);
  const lines = await admin
    .from("receipt_lines")
    .select("id", { count: "exact" })
    .eq("receipt_id", id);
  expect(lines.count).toBe(1);
});

test("a killed worker is recovered by a fresh process and a stale result is rejected", async ({
  page,
  request,
}) => {
  await login(page);
  const id = await capture(page, "crash");
  await expect
    .poll(
      async () =>
        (
          await admin
            .from("jobs")
            .select("status")
            .eq("receipt_id", id)
            .single()
        ).data?.status,
    )
    .toBe("processing");
  const oldJob = (
    await admin.from("jobs").select("*").eq("receipt_id", id).single()
  ).data!;
  const restarted = await request.post("http://127.0.0.1:4012/restart");
  expect(restarted.ok()).toBe(true);
  await ready(page);
  await confirm(page);
  expect(await observationCount(id)).toBe(1);
  const stale = await admin.rpc("complete_job", {
    p_id: oldJob.id,
    p_token: oldJob.lease_token,
    p_draft: {},
  });
  expect(stale.error).toBeNull();
  expect(stale.data).toBe(false);
});

test("unknown package sizes stay unknown and drafts are excluded from spending", async ({
  page,
}) => {
  await login(page);
  const id = await capture(page, "unknown");
  await ready(page);
  await expect(page.getByLabel("Item 1 quantity", { exact: true })).toHaveValue(
    "",
  );
  await expect(
    page.getByLabel("Item 1 package size", { exact: true }),
  ).toHaveValue("");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Changes saved");
  const draftData = await workspace(page);
  expect(
    draftData.receipts.find((r: { id: string }) => r.id === id).status,
  ).toBe("review");
  expect(
    draftData.observations.some(
      (o: { receipt_id: string }) => o.receipt_id === id,
    ),
  ).toBe(false);
  await page.getByLabel("Item 1 quantity", { exact: true }).fill("1");
  await confirm(page);
  const observation = (
    await admin
      .from("observations_read")
      .select("*")
      .eq("receipt_id", id)
      .single()
  ).data!;
  expect(observation.package_size).toBeNull();
  expect(observation.unit).toBeNull();
  await page
    .getByRole("link", { name: "Search prices for item 1", exact: true })
    .click();
  await expect(page).toHaveURL(/\/prices\?item=/);
  const row = page
    .getByTestId("price-row")
    .filter({ has: page.locator('a[href="/capture/' + id + '"]') });
  await expect(row).toContainText("Unit price unknown");
});

test("unknown item amounts require acknowledgement and stay unknown in spending", async ({
  page,
}) => {
  await login(page);
  const id = await capture(page, "missing-amount");
  await ready(page);
  await expect(page.getByLabel("Item 1 amount", { exact: true })).toHaveValue(
    "",
  );
  await page
    .getByLabel("Item 1 name", { exact: true })
    .fill("Missing amount " + nonce());
  await page
    .getByLabel("Item 1 category", { exact: true })
    .selectOption("Household");
  await page
    .getByLabel("Item 1 comparison group", { exact: true })
    .fill("Unknown amount");
  await page
    .getByRole("button", { name: "Confirm receipt", exact: true })
    .click();
  await expect(
    page.getByRole("alert", { name: "Error", exact: true }),
  ).toContainText("acknowledge");
  await page
    .getByLabel("I’ve checked and acknowledge the unresolved amounts.", {
      exact: true,
    })
    .check();
  await confirm(page);
  const state = await workspace(page);
  expect(
    state.lines.find((line: { receipt_id: string }) => line.receipt_id === id)
      .line_amount,
  ).toBeNull();
  expect(await observationCount(id)).toBe(0);
  await page.goto("/spending");
  const category = page
    .locator(".category-row")
    .filter({ hasText: "Household" });
  await expect(category).toContainText("Unknown");
  await expect(category).not.toContainText("$0.00");
  const row = page
    .getByRole("row")
    .filter({ has: page.locator('a[href="/capture/' + id + '"]') });
  await expect(row).toContainText("Unknown");
});

test("shelf labels produce observations without affecting receipt spending", async ({
  page,
}) => {
  await login(page);
  await page.goto("/capture");
  await page.getByRole("button", { name: "Shelf label", exact: true }).click();
  await page.getByLabel("Upload receipt file").setInputFiles({
    name: "shelf-" + nonce() + ".png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(page).toHaveURL(/\/capture\/[0-9a-f-]+$/);
  const id = page.url().split("/").at(-1)!;
  await ready(page);
  await page.getByLabel("Purchase date", { exact: true }).fill("2026-10-05");
  await confirm(page);
  const observed = (
    await admin
      .from("observations")
      .select("source,price")
      .eq("receipt_id", id)
      .single()
  ).data!;
  expect(observed.source).toBe("shelf");
  const state = await workspace(page);
  expect(state.receipts.find((r: { id: string }) => r.id === id).kind).toBe(
    "shelf",
  );
  await page.goto("/spending");
  expect(await page.locator('a[href="/capture/' + id + '"]').count()).toBe(0);
});

test("manual in-store and online prices show conversions, channels and source links", async ({
  page,
}) => {
  await login(page);
  await page.goto("/prices?item=Bananas");
  await expect(
    page.getByRole("button", { name: "Add a price", exact: true }),
  ).toBeVisible();
  const condition = "known-branch-" + nonce();
  await addPrice(page, {
    branch: "Metro College Park",
    channel: "in-store",
    price: "3.00",
    size: "500",
    unit: "g",
    condition,
  });
  const known = page.getByTestId("price-row").filter({ hasText: condition });
  await expect(known).toContainText("$6.00 / kg");
  await expect(known).toContainText("in-store");
  await expect(
    known.getByRole("link", { name: "Open price source" }),
  ).toHaveAttribute("href", "https://www.metro.ca/");
  await addPrice(page, {
    store: "Online shop",
    channel: "online delivery",
    price: "2.00",
    size: "1",
    unit: "kg",
    condition: "",
  });
  const online = page
    .getByTestId("price-row")
    .filter({ hasText: "Online shop" });
  await expect(online).toContainText("online delivery");
  await expect(online).toContainText("Branch unknown");
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        version: 8,
        sources: {},
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#e9eee3" },
          },
        ],
      }),
    }),
  );
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Metro College Park", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Online shop", exact: true }),
  ).toHaveCount(0);
});

test("flyer CSV import is atomic, excludes expired offers, and preserves conditions", async ({
  page,
}) => {
  await login(page);
  let releaseWorkspace!: () => void;
  const workspaceReady = new Promise<void>((resolve) => {
    releaseWorkspace = resolve;
  });
  await page.route(
    "**/api/workspace",
    async (route) => {
      await workspaceReady;
      await route.continue();
    },
    { times: 1 },
  );
  await page.goto("/prices?item=Bananas");
  try {
    await expect(
      page.getByRole("button", { name: "Import CSV", exact: true }),
    ).toBeDisabled();
  } finally {
    releaseWorkspace();
  }
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const old = "2020-01-01",
    tag = "offer-" + nonce();
  const header =
    "item_name,store_branch,price,package_size,unit,valid_from,valid_to,source_url,channel,conditions";
  await page.getByRole("button", { name: "Import CSV", exact: true }).click();
  await page
    .getByLabel("Flyer CSV data", { exact: true })
    .fill(
      header +
        "\nBananas,Metro College Park,1.50,500,g," +
        day +
        "," +
        day +
        ",https://www.metro.ca/,in-store," +
        tag +
        "\nBananas,Metro College Park,0.99,500,g," +
        old +
        "," +
        old +
        ",https://www.metro.ca/,in-store,",
    );
  await page
    .getByRole("button", { name: "Import offers", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Flyer offers saved");
  const card = page.getByTestId("offer-card").filter({ hasText: tag });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("$3.00 / kg");
  await expect(
    card.getByRole("link", { name: "Official source" }),
  ).toHaveAttribute("href", "https://www.metro.ca/");
  await expect(
    page.getByTestId("offer-card").filter({ hasText: "$0.99" }),
  ).toHaveCount(0);
  const imported = (await workspace(page)).offers;
  expect(
    imported.find((offer: { valid_to: string }) => offer.valid_to === old)
      .conditions,
  ).toBe("");
  const before = imported.length;
  await page.getByRole("button", { name: "Import CSV", exact: true }).click();
  await page
    .getByLabel("Flyer CSV data", { exact: true })
    .fill(
      header +
        "\nBananas,Metro College Park,1.50,500,g," +
        day +
        "," +
        day +
        ",https://www.metro.ca/,in-store,valid\nBananas,Metro College Park,INVALID,500,g," +
        day +
        "," +
        day +
        ",https://www.metro.ca/,in-store,bad",
    );
  await page
    .getByRole("button", { name: "Import offers", exact: true })
    .click();
  await expect(
    page.getByRole("alert", { name: "Error", exact: true }),
  ).toContainText("price");
  expect((await workspace(page)).offers.length).toBe(before);
});

test("confirmed item corrections are reused on the next extraction", async ({
  page,
}) => {
  await login(page);
  const first = await capture(page);
  await ready(page);
  const remembered = "Bananas " + test.info().project.name;
  await page.getByLabel("Item 1 name", { exact: true }).fill(remembered);
  await page
    .getByLabel("Item 1 comparison group", { exact: true })
    .fill("Bananas");
  await confirm(page);
  const second = await capture(page);
  expect(second).not.toBe(first);
  await ready(page);
  await expect(page.getByLabel("Item 1 name", { exact: true })).toHaveValue(
    remembered,
  );
});

test("another account cannot read, change, export or sign a URL for the owner's records", async ({
  page,
}) => {
  await login(page);
  const id = await capture(page);
  await ready(page);
  await confirm(page);
  const detail = await (await page.request.get("/api/receipts/" + id)).json();
  const ownedItem = (await workspace(page)).items[0];
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await login(page, "other@example.test");
  expect((await page.request.get("/api/receipts/" + id)).status()).toBe(404);
  const malicious = await page.request.post("/api/receipts/" + id, {
    headers: { Origin: "http://127.0.0.1:3000" },
    data: {
      version: detail.receipt.version,
      confirm: true,
      draft: { ...detail.receipt, lines: detail.lines },
    },
  });
  expect(malicious.status()).toBe(409);
  const foreignPrice = await page.request.post("/api/prices", {
    headers: { Origin: "http://127.0.0.1:3000" },
    data: {
      item_id: ownedItem.id,
      branch_id: null,
      store_name: "Unauthorized",
      observed_on: "2026-10-05",
      price: "1.00",
      package_size: null,
      unit: null,
      source_url: null,
      channel: "in-store",
      conditions: "",
    },
  });
  expect(foreignPrice.status()).toBe(409);
  const state = await workspace(page);
  expect(state.receipts).toEqual([]);
  expect(state.observations).toEqual([]);
  const csv = await (await page.request.get("/api/export")).text();
  expect(csv).not.toContain("BANANA 500G");
  // Test RLS directly as the other authenticated account, in addition to app routes.
  const other = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  await other.auth.signInWithPassword({
    email: "other@example.test",
    password,
  });
  const signed = await other.storage
    .from("receipts")
    .createSignedUrl(detail.receipt.file_path, 60);
  expect(signed.error).not.toBeNull();
  const direct = await other.from("receipts").select("id").eq("id", id);
  expect(direct.data).toEqual([]);
  const claim = await other.rpc("claim_job", { p_lease_seconds: 4 });
  expect(claim.error).not.toBeNull();
});

test("refund receipts reduce spending without becoming negative price observations", async ({
  page,
}) => {
  await login(page);
  const before = await workspace(page);
  const baseline = before.receipts
    .filter(
      (r: { status: string; kind: string; purchase_date: string }) =>
        r.status === "confirmed" &&
        r.kind === "receipt" &&
        r.purchase_date?.startsWith("2026-10"),
    )
    .reduce(
      (sum: Decimal, r: { total: string }) => sum.add(r.total),
      new Decimal(0),
    );
  const id = await capture(page, "refund");
  await ready(page);
  await expect(page.getByTestId("reconciliation")).toContainText(
    "The amounts balance",
  );
  await confirm(page);
  expect(await observationCount(id)).toBe(0);
  await page.goto("/spending");
  await page.getByLabel("Spending month", { exact: true }).fill("2026-10");
  const total = baseline.minus("2.50");
  await expect(page.getByTestId("spending-total")).toHaveText(
    (total.isNegative() ? "-$" : "$") + total.abs().toFixed(2),
  );
  const csv = await (await page.request.get("/api/export")).text();
  expect(csv).toContain('"-2.50"');
});
