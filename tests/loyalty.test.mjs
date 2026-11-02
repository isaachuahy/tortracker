import assert from "node:assert/strict";
import test from "node:test";
import { loyaltyImportSchema, loyaltyOfferSchema, loyaltyOfferStatus, loyaltyTransactionSchema } from "../src/lib/loyalty.ts";

const offer = {
  source_id: "pc-offer-1", title: "Earn points on a grocery shop", scope: "basket",
  terms: "Spend $75 before taxes to earn 15,000 points. Personal offer; see source for exclusions.",
  source_url: "https://www.pcoptimum.ca/offers", observed_at: "2026-10-23T15:00:00Z",
};
const transaction = {
  source_id: "pc-transaction-1", points_delta: -10000, type: "redeemed",
  description: "Points redeemed at checkout", source_url: "https://www.pcoptimum.ca/transactions",
  observed_at: "2026-10-23T15:00:00Z",
};

test("basket and multiplier rewards need no invented cash price or fixed points", () => {
  const basket = loyaltyOfferSchema.parse({ ...offer, points: 15000, minimum_spend: "75.00" });
  assert.equal(basket.minimum_spend, "75.00");
  assert.equal(basket.points, 15000);
  assert.equal(basket.item_id, null);
  assert.equal(basket.valid_from, null);
  assert.equal(loyaltyOfferStatus(basket), "unknown");
  const multiplied = loyaltyOfferSchema.parse({ ...offer, points_multiplier: "20.0" });
  assert.equal(multiplied.points, null);
  assert.equal(multiplied.points_multiplier, "20.0");
  assert.equal(loyaltyOfferSchema.safeParse({ ...offer, price: "0.00" }).success, false);
});

test("unknown validity stays unknown even when an offer is loaded", () => {
  const parsed = loyaltyOfferSchema.parse({ ...offer, activation_state: "active" });
  assert.equal(loyaltyOfferStatus(parsed, new Date("2026-10-23T15:00:00Z")), "unknown");
  assert.equal(parsed.starts_at, null);
  assert.equal(parsed.ends_at, null);
});

test("exact offer windows are half-open and date-only windows include Toronto's full final day", () => {
  const timed = loyaltyOfferSchema.parse({ ...offer, starts_at: "2026-11-01T10:00:00-05:00", ends_at: "2026-11-01T12:00:00-05:00" });
  assert.equal(loyaltyOfferStatus(timed, new Date("2026-11-01T14:59:59Z")), "upcoming");
  assert.equal(loyaltyOfferStatus(timed, new Date("2026-11-01T15:00:00Z")), "active");
  assert.equal(loyaltyOfferStatus(timed, new Date("2026-11-01T17:00:00Z")), "expired");
  const dated = loyaltyOfferSchema.parse({ ...offer, valid_from: "2026-11-01", valid_to: "2026-11-01" });
  assert.equal(loyaltyOfferStatus(dated, new Date("2026-11-02T04:59:59Z")), "active");
  assert.equal(loyaltyOfferStatus(dated, new Date("2026-11-02T05:00:00Z")), "expired");
});

test("invalid or contradictory date bounds are rejected rather than guessed", () => {
  for (const fields of [
    { valid_from: "2026-10-23", valid_to: "2026-10-22" },
    { valid_from: "2026-02-30", valid_to: "2026-03-01" },
    { starts_at: "2026-10-23T00:00:00Z", ends_at: "2026-10-23T00:00:00Z" },
    { starts_at: "2026-10-23T00:00:00", ends_at: "2026-10-24T00:00:00" },
  ]) assert.equal(loyaltyOfferSchema.safeParse({ ...offer, ...fields }).success, false);
});

test("an expiry-only offer preserves unknown validity before expiry and proves expiration afterward", () => {
  const exact = loyaltyOfferSchema.parse({ ...offer, ends_at: "2026-10-24T04:00:00Z" });
  assert.equal(exact.starts_at, null);
  assert.equal(loyaltyOfferStatus(exact, new Date("2026-10-24T03:59:59Z")), "unknown");
  assert.equal(loyaltyOfferStatus(exact, new Date("2026-10-24T04:00:00Z")), "expired");
  const dated = loyaltyOfferSchema.parse({ ...offer, valid_to: "2026-11-01" });
  assert.equal(dated.valid_from, null);
  assert.equal(loyaltyOfferStatus(dated, new Date("2026-11-02T04:59:59Z")), "unknown");
  assert.equal(loyaltyOfferStatus(dated, new Date("2026-11-02T05:00:00Z")), "expired");
});

test("a start-only offer proves upcoming status but not subsequent activity", () => {
  const exact = loyaltyOfferSchema.parse({ ...offer, starts_at: "2026-10-24T04:00:00Z" });
  assert.equal(exact.ends_at, null);
  assert.equal(loyaltyOfferStatus(exact, new Date("2026-10-24T03:59:59Z")), "upcoming");
  assert.equal(loyaltyOfferStatus(exact, new Date("2026-10-24T04:00:00Z")), "unknown");
  const dated = loyaltyOfferSchema.parse({ ...offer, valid_from: "2026-11-02" });
  assert.equal(dated.valid_to, null);
  assert.equal(loyaltyOfferStatus(dated, new Date("2026-11-02T04:59:59Z")), "upcoming");
  assert.equal(loyaltyOfferStatus(dated, new Date("2026-11-02T05:00:00Z")), "unknown");
});

test("partial exact-time evidence takes precedence without borrowing calendar bounds", () => {
  const mixed = loyaltyOfferSchema.parse({
    ...offer, ends_at: "2026-10-24T04:00:00Z", valid_from: "2026-10-20", valid_to: "2026-10-25",
  });
  assert.equal(loyaltyOfferStatus(mixed, new Date("2026-10-23T12:00:00Z")), "unknown");
  assert.equal(loyaltyOfferStatus(mixed, new Date("2026-10-24T04:00:00Z")), "expired");
});

test("ledger entries keep signed points and unknown event dates without creating a purchase", () => {
  const parsed = loyaltyTransactionSchema.parse(transaction);
  assert.equal(parsed.points_delta, -10000);
  assert.equal(parsed.occurred_at, null);
  assert.equal(parsed.receipt_id, null);
  assert.equal(loyaltyTransactionSchema.safeParse({ ...transaction, points_delta: 10000 }).success, false);
  assert.equal(loyaltyTransactionSchema.safeParse({ ...transaction, type: "earned" }).success, false);
  assert.equal(loyaltyTransactionSchema.parse({ ...transaction, type: "adjustment" }).points_delta, -10000);
  assert.equal(loyaltyTransactionSchema.safeParse({ ...transaction, total: "10.00" }).success, false);
});

test("loyalty imports are bounded and reject duplicate source identities within a table", () => {
  assert.equal(loyaltyImportSchema.safeParse({ offers: [], transactions: [] }).success, false);
  assert.equal(loyaltyImportSchema.safeParse({ offers: [offer, offer] }).success, false);
  assert.equal(loyaltyImportSchema.safeParse({ transactions: [transaction, transaction] }).success, false);
  const both = loyaltyImportSchema.parse({ offers: [offer], transactions: [{ ...transaction, source_id: offer.source_id }] });
  assert.equal(both.offers.length, 1);
  assert.equal(both.transactions.length, 1);
  const offers = Array.from({ length: 200 }, (_, index) => ({ ...offer, source_id: String(index) }));
  assert.equal(loyaltyImportSchema.safeParse({ offers, transactions: [transaction] }).success, false);
  assert.equal(loyaltyImportSchema.parse({ offers }).offers.length, 200);
});

test("points, money thresholds and provenance reject ambiguous or unsafe values", () => {
  for (const fields of [
    { points: 1.5 }, { points: -1 }, { points_multiplier: "0" }, { points_multiplier: 20 },
    { minimum_spend: 75 }, { minimum_spend: "-1.00" }, { minimum_quantity: 0 },
    { source_url: "http://www.pcoptimum.ca/offers" }, { observed_at: "2026-10-23" }, { terms: " " },
  ]) assert.equal(loyaltyOfferSchema.safeParse({ ...offer, ...fields }).success, false);
});
