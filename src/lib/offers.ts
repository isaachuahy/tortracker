import type { Offer } from "./types";

export type OfferStatus = "active" | "upcoming" | "expired";
export type OfferWindow = Pick<Offer, "valid_from" | "valid_to" | "starts_at" | "ends_at">;

/** Dates printed on Canadian flyers include their last day, in the store's timezone. */
export function torontoDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Exact timestamps are [start, end); date-only flyer ranges include both dates. */
export function offerStatus(offer: OfferWindow, now = new Date()): OfferStatus {
  if (offer.starts_at && offer.ends_at) {
    const instant = now.getTime();
    if (instant < Date.parse(offer.starts_at)) return "upcoming";
    if (instant >= Date.parse(offer.ends_at)) return "expired";
    return "active";
  }
  const date = torontoDate(now);
  if (date < offer.valid_from) return "upcoming";
  if (date > offer.valid_to) return "expired";
  return "active";
}
