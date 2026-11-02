import { comparable, sum } from "./money";
import type { Item, Observation, Offer, Workspace } from "./types";
import { offerStatus } from "./offers";

// Timestamp bounds are half-open: a sale ends at ends_at, not a millisecond later.
// Older flyer imports use inclusive Toronto calendar dates instead.
export type TimedOffer = Offer & {
  starts_at?: string | null;
  ends_at?: string | null;
  points?: number | null;
  loyalty_program?: string | null;
};
export type SaleStatus = "active" | "upcoming" | "expired";

export const saleStatus = offerStatus;

export function monthlySpending(data: Workspace, month: string) {
  const receipts = data.receipts.filter(
    (receipt) => receipt.kind === "receipt" && receipt.status === "confirmed" &&
      receipt.purchase_date?.slice(0, 7) === month,
  );
  const known = receipts.filter((receipt) => receipt.total != null && receipt.total !== "");
  return {
    count: receipts.length,
    total: receipts.length > 0 && known.length === 0 ? null : sum(known.map((receipt) => receipt.total)),
    unknown: receipts.length - known.length,
  };
}

export function latestObservation(item: Item, observations: Observation[]) {
  return observations
    .filter((observation) => observation.item_id === item.id)
    .sort((a, b) => {
      const dateOrder = b.observed_on.localeCompare(a.observed_on);
      if (dateOrder) return dateOrder;
      // The read view carries creation time even for same-day observations.
      const created = (value: Observation) => (value as Observation & { created_at?: string }).created_at ?? "";
      return created(b).localeCompare(created(a)) || b.id.localeCompare(a.id);
    })[0] ?? null;
}

export function bestComparableOffer(
  item: Item,
  observation: Observation | null,
  data: Workspace,
  now = new Date(),
): TimedOffer | null {
  // A smaller sticker price cannot establish a better price across different
  // package sizes or weight/volume/count dimensions.
  if (!observation) return null;
  const reference = comparable(observation.price, observation.package_size, observation.unit);
  if (!reference) return null;
  const sameGroup = new Set(data.items.filter((candidate) =>
    candidate.id === item.id || (item.comparison_group.trim() !== "" &&
      candidate.comparison_group === item.comparison_group)).map((candidate) => candidate.id));
  const candidates = data.offers
    .filter((offer) => sameGroup.has(offer.item_id) && saleStatus(offer, now) === "active")
    .map((offer) => ({ offer, unitPrice: comparable(offer.price, offer.package_size, offer.unit) }))
    .filter((candidate) => candidate.unitPrice?.unit === reference.unit)
    .sort((a, b) => a.unitPrice!.value.cmp(b.unitPrice!.value));
  return candidates[0]?.offer ?? null;
}

export function offerStores(data: Workspace, offerId: string) {
  const ids = new Set(data.offer_stores.filter((row) => row.offer_id === offerId).map((row) => row.branch_id));
  return data.stores.filter((store) => ids.has(store.id)).map((store) => store.name);
}

export function saleBoundary(offer: TimedOffer, boundary: "start" | "end") {
  const timestamp = boundary === "start" ? offer.starts_at : offer.ends_at;
  if (timestamp && Number.isFinite(Date.parse(timestamp))) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Toronto",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(timestamp));
  }
  return (boundary === "start" ? offer.valid_from : offer.valid_to) +
    (boundary === "end" ? " · end of day" : " · start of day");
}
