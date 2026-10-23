import { z } from "zod";

export const MAX_LOYALTY_IMPORT_BYTES = 2 * 1024 * 1024;

const sourceId = z.string().trim().min(1).max(250);
const timestamp = z.iso.datetime({ offset: true });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
  (value) => !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value,
  "Use a valid calendar date",
);
const sourceUrl = z.url().max(2048).refine((value) => new URL(value).protocol === "https:", "Use an HTTPS source link");
const nullable = <T extends z.ZodType>(schema: T) => schema.nullable().optional().default(null);
const amount = z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, "Use a non-negative decimal amount with up to two decimal places");
const multiplier = z.string().regex(/^\d{1,6}(\.\d{1,4})?$/, "Use a positive decimal multiplier with up to four decimal places")
  .refine((value) => !/^0*(\.0*)?$/.test(value), "A points multiplier must be positive");

/** A personalized reward is not a cash-price offer or a purchase. */
export const loyaltyOfferSchema = z.object({
  source_id: sourceId,
  title: z.string().trim().min(1).max(250),
  scope: z.enum(["item", "category", "basket", "unknown"]),
  item_id: nullable(z.uuid()),
  points: nullable(z.number().int().min(0).max(2147483647)),
  points_multiplier: nullable(multiplier),
  minimum_spend: nullable(amount),
  minimum_quantity: nullable(z.number().int().min(1).max(2147483647)),
  starts_at: nullable(timestamp),
  ends_at: nullable(timestamp),
  valid_from: nullable(date),
  valid_to: nullable(date),
  terms: z.string().trim().min(1).max(4000),
  source_url: sourceUrl,
  activation_state: z.enum(["active", "available", "unknown"]).default("unknown"),
  observed_at: timestamp,
}).strict().superRefine((offer, context) => {
  if (offer.starts_at && offer.ends_at && Date.parse(offer.ends_at) <= Date.parse(offer.starts_at))
    context.addIssue({ code: "custom", path: ["ends_at"], message: "The exclusive end time must be later than the start time" });
  if (offer.valid_from && offer.valid_to && offer.valid_to < offer.valid_from)
    context.addIssue({ code: "custom", path: ["valid_to"], message: "The inclusive end date must be on or after the start date" });
});

export const loyaltyTransactionSchema = z.object({
  source_id: sourceId,
  occurred_at: nullable(timestamp),
  observed_at: timestamp,
  points_delta: z.number().int().min(-2147483648).max(2147483647),
  type: z.enum(["earned", "redeemed", "adjustment", "unknown"]),
  merchant: nullable(z.string().trim().min(1).max(160)),
  receipt_id: nullable(z.uuid()),
  source_url: sourceUrl,
  description: z.string().max(2000),
}).strict().superRefine((transaction, context) => {
  if ((transaction.type === "earned" && transaction.points_delta < 0) ||
      (transaction.type === "redeemed" && transaction.points_delta > 0))
    context.addIssue({ code: "custom", path: ["points_delta"], message: "Earned points are positive; redeemed points are negative" });
});

export const loyaltyImportSchema = z.object({
  offers: z.array(loyaltyOfferSchema).max(200).default([]),
  transactions: z.array(loyaltyTransactionSchema).max(200).default([]),
}).strict().superRefine((data, context) => {
  if (data.offers.length + data.transactions.length < 1 || data.offers.length + data.transactions.length > 200)
    context.addIssue({ code: "custom", message: "Import between 1 and 200 offers and transactions in total" });
  for (const name of ["offers", "transactions"] as const) {
    const seen = new Set<string>();
    data[name].forEach((row, index) => {
      if (seen.has(row.source_id))
        context.addIssue({ code: "custom", path: [name, index, "source_id"], message: "Each record in this import needs a distinct source ID" });
      seen.add(row.source_id);
    });
  }
});

export type LoyaltyOfferInput = z.infer<typeof loyaltyOfferSchema>;
export type LoyaltyTransactionInput = z.infer<typeof loyaltyTransactionSchema>;
export type LoyaltyOffer = LoyaltyOfferInput & { id: string; user_id: string; created_at: string; updated_at: string };
export type LoyaltyTransaction = LoyaltyTransactionInput & { id: string; user_id: string; created_at: string; updated_at: string };
export type LoyaltyData = { offers: LoyaltyOffer[]; transactions: LoyaltyTransaction[] };
export type LoyaltyOfferStatus = "active" | "upcoming" | "expired" | "unknown";

/**
 * Use exact times if either is known; otherwise use inclusive Toronto dates.
 * A missing bound stays unknown: an expiry alone can prove expiration, never activity.
 * Date fields do not fill gaps in an exact-time window.
 */
export function loyaltyOfferStatus(
  offer: Pick<LoyaltyOfferInput, "starts_at" | "ends_at" | "valid_from" | "valid_to">,
  now = new Date(),
): LoyaltyOfferStatus {
  if (offer.starts_at || offer.ends_at) {
    if (offer.ends_at && now.getTime() >= Date.parse(offer.ends_at)) return "expired";
    if (offer.starts_at && now.getTime() < Date.parse(offer.starts_at)) return "upcoming";
    return offer.starts_at && offer.ends_at ? "active" : "unknown";
  }
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  if (offer.valid_to && day > offer.valid_to) return "expired";
  if (offer.valid_from && day < offer.valid_from) return "upcoming";
  return offer.valid_from && offer.valid_to ? "active" : "unknown";
}
