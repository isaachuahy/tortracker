export type Unit = "g" | "kg" | "ml" | "l" | "count";
export type Channel =
  | "in-store"
  | "online pickup"
  | "online delivery"
  | "unspecified";
export type Store = {
  id: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  source_url: string;
};
export type Item = {
  id: string;
  name: string;
  category: string;
  comparison_group: string;
};
export type Receipt = {
  id: string;
  kind: "receipt" | "shelf";
  file_name: string;
  mime_type: string;
  status: "queued" | "processing" | "review" | "confirmed" | "failed";
  version: number;
  store_name: string | null;
  branch_id: string | null;
  purchase_date: string | null;
  subtotal: string | null;
  tax: string | null;
  receipt_discount: string | null;
  fees: string | null;
  total: string | null;
  notes: string | null;
  uncertain_fields: string[];
  acknowledged_difference: boolean;
  created_at: string;
};
export type Line = {
  id?: string;
  receipt_id?: string;
  original_text: string;
  item_name: string;
  category: string;
  comparison_group: string;
  quantity: string | null;
  package_size: string | null;
  unit: Unit | null;
  discount: string | null;
  line_amount: string | null;
  regular_price: string | null;
  sale_price: string | null;
  uncertain: boolean;
};
export type Observation = {
  id: string;
  item_id: string;
  receipt_id: string | null;
  branch_id: string | null;
  store_name: string;
  observed_on: string;
  price: string;
  package_size: string | null;
  unit: Unit | null;
  regular_price: string | null;
  sale_price: string | null;
  source: "receipt" | "shelf" | "manual";
  source_url: string | null;
  channel: Channel;
  conditions: string;
};
export type Offer = {
  id: string;
  item_id: string;
  price: string;
  package_size: string | null;
  unit: Unit | null;
  regular_price: string | null;
  valid_from: string;
  valid_to: string;
  source_url: string;
  channel: Channel;
  conditions: string;
};
export type Workspace = {
  receipts: Receipt[];
  lines: Line[];
  items: Item[];
  stores: Store[];
  observations: Observation[];
  offers: Offer[];
  offer_stores: { offer_id: string; branch_id: string }[];
};
