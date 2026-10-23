import assert from "node:assert/strict";
import { test } from "node:test";
import {
  flyerSourceProvider, isPublicAddress, mapFlyerOffers,
  MAX_FEED_BYTES, parseFlyerFeed, resolveFlyerFeedUrl, validateFeedUrl,
} from "../src/lib/flyer-feed.ts";

const headers = "item_name,store_branch,price,package_size,unit,valid_from,valid_to,source_url,channel,conditions";
const base = {
  item_name: "Milk 2%", store_branch: "Local Grocer Downtown", price: "4.99",
  package_size: "2", unit: "l", valid_from: "2026-10-22", valid_to: "2026-10-28",
  source_url: "https://example.com/flyer", channel: "in-store", conditions: "",
};
const parse = (overrides = {}) => parseFlyerFeed(JSON.stringify([{ ...base, ...overrides }]), "application/json");
const items = [{ id: "item-1", name: "Milk 2%" }];
const stores = [{ id: "branch-1", name: "Local Grocer Downtown" }];

test("CSV handles quoted commas and preserves decimal money strings", () => {
  const [row] = parseFlyerFeed(`${headers}\nMilk 2%,Local Grocer Downtown,4.9900,2,l,2026-10-22,2026-10-28,https://example.com/flyer,in-store,"Members only, limit 2"`);
  assert.equal(row.price, "4.9900");
  assert.equal(row.conditions, "Members only, limit 2");
  assert.equal(row.points, 0);
  assert.equal(row.starts_at, null);
});

test("CSV rejects missing, duplicate, and malformed columns", () => {
  assert.throws(() => parseFlyerFeed("item_name,price\nMilk 2%,4.99"), /missing columns/);
  assert.throws(() => parseFlyerFeed(`${headers},price\nMilk 2%,Local Grocer Downtown,4.99,2,l,2026-10-22,2026-10-28,https://example.com/flyer,in-store,,5.99`), /duplicate headers/);
  assert.throws(() => parseFlyerFeed(`${headers}\nMilk 2%,4.99`), /malformed rows/);
});

test("optional regular prices are preserved from CSV and JSON without inference", () => {
  const csvRows = parseFlyerFeed(`${headers},regular_price\nMilk 2%,Local Grocer Downtown,4.99,2,l,2026-10-22,2026-10-28,https://example.com/flyer,in-store,,6.4900`);
  const [csvOffer] = mapFlyerOffers(csvRows, items, stores, "test");
  const [jsonOffer] = mapFlyerOffers(parse({ regular_price: "7.99" }), items, stores, "test");
  const [noReference] = mapFlyerOffers(parse({ points: 200, loyalty_program: "PC Optimum" }), items, stores, "test");
  assert.equal(csvOffer.regular_price, "6.4900");
  assert.equal(jsonOffer.regular_price, "7.99");
  assert.equal(noReference.regular_price, null);
  assert.equal(parse({ regular_price: "" })[0].regular_price, null);
  assert.throws(() => parse({ regular_price: "-1.00" }), /regular_price/);
  assert.throws(() => parse({ regular_price: 6.49 }), /regular_price/);
  const [updated] = mapFlyerOffers(parse({ regular_price: "8.49" }), items, stores, "test");
  assert.equal(updated.source_id, jsonOffer.source_id);
});

test("JSON enforces dimensions, dates, timestamps, points and decimal text", () => {
  assert.throws(() => parse({ price: 4.99 }), /price/);
  assert.throws(() => parse({ valid_from: "2026-02-30" }), /calendar date/);
  assert.throws(() => parse({ valid_to: "2026-10-01" }), /Expiry/);
  assert.throws(() => parse({ package_size: "" }), /both package_size and unit/);
  assert.throws(() => parse({ starts_at: "2026-10-22T00:00:00" }), /starts_at/);
  assert.throws(() => parse({ starts_at: "2026-10-22T04:00:00Z" }), /both starts_at and ends_at/);
  assert.throws(() => parse({ starts_at: "2026-10-22T00:00:00-04:00", ends_at: "2026-10-22T04:00:00Z" }), /exclusive end/);
  assert.throws(() => parse({ points: "200" }), /Points require/);
  assert.throws(() => parse({ points: "2.5", loyalty_program: "PC Optimum" }), /points/);
  assert.throws(() => parse({ points: -1, loyalty_program: "PC Optimum" }), /points/);
  assert.throws(() => parse({ source_url: "file:///tmp/data" }), /HTTP or HTTPS/);
  assert.equal(parse({ points: "200", loyalty_program: "PC Optimum", starts_at: "2026-10-22T00:00:00-04:00", ends_at: "2026-10-29T00:00:00-04:00" })[0].points, 200);
});

test("feed bounds reject excessive input before import", () => {
  assert.throws(() => parseFlyerFeed(" ".repeat(MAX_FEED_BYTES + 1)), /2 MiB/);
  assert.throws(() => parseFlyerFeed(JSON.stringify(Array.from({ length: 501 }, () => base))), /between 1 and 500/);
  assert.throws(() => parseFlyerFeed("[]"), /between 1 and 500/);
  assert.throws(() => parseFlyerFeed('{"rows":[]}'), /offers array/);
});

test("exact mapping rejects unknown or ambiguous names before writes", () => {
  assert.throws(() => mapFlyerOffers(parse({ item_name: "milk 2%" }), items, stores, "test"), /unknown item/);
  assert.throws(() => mapFlyerOffers(parse(), items, [], "test"), /unknown store branch/);
  assert.throws(() => mapFlyerOffers(parse(), items, [...stores, { id: "branch-2", name: stores[0].name }], "test"), /ambiguous store branch/);
});

test("repeated imports and price corrections retain stable source identity", () => {
  const [first] = mapFlyerOffers(parse(), items, stores, "flyer-feed:test");
  const [second] = mapFlyerOffers(parse({ price: "3.99", conditions: "Updated terms" }), items, stores, "flyer-feed:test");
  assert.equal(first.source_id, second.source_id);
  assert.deepEqual(first.branch_ids, ["branch-1"]);
  assert.equal(first.price, "4.99");
  const [newPeriod] = mapFlyerOffers(parse({ valid_from: "2026-10-23" }), items, stores, "flyer-feed:test");
  assert.notEqual(first.source_id, newPeriod.source_id);
  assert.equal(mapFlyerOffers([...parse(), ...parse()], items, stores, "test").length, 1);
  assert.throws(() => mapFlyerOffers([...parse({ source_id: "offer-1" }), ...parse({ source_id: "offer-1", price: "3.99" })], items, stores, "test"), /repeats a source_id/);
});

test("regional feed configuration normalizes postal codes and isolates identity", () => {
  assert.deepEqual(resolveFlyerFeedUrl("https://example.com/{postal_code}.csv", "m5v 1a1"), { url: "https://example.com/M5V1A1.csv", postalCode: "M5V1A1" });
  assert.throws(() => resolveFlyerFeedUrl("https://example.com/{postal_code}.csv"), /Save your postal code/);
  assert.throws(() => resolveFlyerFeedUrl("https://example.com/feed", "invalid"), /valid Canadian postal code/);
  const url = new URL("https://example.com/feed");
  assert.notEqual(flyerSourceProvider(url, "M5V1A1"), flyerSourceProvider(url, "M5H2N2"));
  assert.equal(flyerSourceProvider(url, "M5V1A1"), flyerSourceProvider(url, "M5V1A1"));
  const [firstRegion] = mapFlyerOffers(parse(), items, stores, flyerSourceProvider(url, "M5V1A1"));
  const [secondRegion] = mapFlyerOffers(parse(), items, stores, flyerSourceProvider(url, "M5H2N2"));
  assert.notEqual(firstRegion.source_id, secondRegion.source_id);
});

test("outbound destinations reject private, special, and alternate-encoded addresses", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "172.16.1.2", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "198.18.0.1", "203.0.113.1", "224.0.0.1", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "2001:db8::1", "2002:7f00:1::", "3fff::1"]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2001:4860:4860::8888"]) assert.equal(isPublicAddress(address), true, address);
  for (const url of ["http://example.com/feed", "https://127.1/feed", "https://2130706433/feed", "https://localhost/feed", "https://private.local/feed", "https://example.com:8443/feed", "https://user:secret@example.com/feed", "https://[::1]/feed"]) {
    assert.throws(() => validateFeedUrl(url));
  }
  assert.throws(() => validateFeedUrl("https://other.example.com/feed", "https://example.com"), /different origin/);
  assert.equal(validateFeedUrl("https://example.com/next", "https://example.com").pathname, "/next");
});
