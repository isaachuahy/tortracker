import assert from "node:assert/strict";
import test from "node:test";
import { offerStatus } from "../src/lib/offers.ts";
import { offerSchema } from "../src/lib/validation.ts";

const dateOffer = { valid_from: "2026-11-01", valid_to: "2026-11-01" };
const validOffer = {
  ...dateOffer,
  item_id: "00000000-0000-4000-8000-000000000001",
  branch_ids: ["00000000-0000-4000-8000-000000000002"],
  price: "4.50",
  source_url: "https://www.metro.ca/",
  channel: "in-store",
  conditions: "",
};

test("a date-only sale includes the full Toronto day across the autumn DST change", () => {
  assert.equal(offerStatus(dateOffer, new Date("2026-11-01T03:59:59Z")), "upcoming");
  assert.equal(offerStatus(dateOffer, new Date("2026-11-01T04:00:00Z")), "active");
  assert.equal(offerStatus(dateOffer, new Date("2026-11-02T04:59:59Z")), "active");
  assert.equal(offerStatus(dateOffer, new Date("2026-11-02T05:00:00Z")), "expired");
});

test("an exact offer starts inclusively and expires exactly at its end", () => {
  const offer = { ...dateOffer, starts_at: "2026-11-01T10:00:00-05:00", ends_at: "2026-11-01T12:00:00-05:00" };
  assert.equal(offerStatus(offer, new Date("2026-11-01T14:59:59Z")), "upcoming");
  assert.equal(offerStatus(offer, new Date("2026-11-01T15:00:00Z")), "active");
  assert.equal(offerStatus(offer, new Date("2026-11-01T17:00:00Z")), "expired");
});

test("old date offers still parse while exact times require a timezone, pair and positive interval", () => {
  assert.equal(offerSchema.parse(validOffer).points, 0);
  for (const timestamps of [
    { starts_at: "2026-11-01T10:00:00Z" },
    { starts_at: "2026-11-01T10:00:00", ends_at: "2026-11-01T11:00:00" },
    { starts_at: "2026-11-01T10:00:00Z", ends_at: "2026-11-01T10:00:00Z" },
    { starts_at: "2026-11-01T10:00:00-05:00", ends_at: "2026-11-01T10:30:00Z" },
  ]) assert.equal(offerSchema.safeParse({ ...validOffer, ...timestamps }).success, false);
});

test("points never alter the cash price and require a named program", () => {
  assert.equal(offerSchema.safeParse({ ...validOffer, points: 2000 }).success, false);
  const parsed = offerSchema.parse({ ...validOffer, points: 2000, loyalty_program: "PC Optimum" });
  assert.equal(parsed.price, "4.50");
  assert.equal(parsed.points, 2000);
  assert.equal(offerSchema.safeParse({ ...validOffer, points: -1, loyalty_program: "PC Optimum" }).success, false);
});

test("import source identity must be a complete bounded pair", () => {
  assert.equal(offerSchema.safeParse({ ...validOffer, source_id: "offer-1" }).success, false);
  const parsed = offerSchema.parse({ ...validOffer, source_id: " offer-1 ", source_provider: "flyer-feed:test" });
  assert.equal(parsed.source_id, "offer-1");
  assert.equal(offerSchema.safeParse({ ...validOffer, source_id: "x".repeat(251), source_provider: "feed" }).success, false);
});
