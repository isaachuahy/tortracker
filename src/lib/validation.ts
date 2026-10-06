import { z } from "zod";
const optional = <T extends z.ZodType>(schema: T) =>
  schema.nullable().optional();
export const amount = z
  .string()
  .regex(
    /^-?\d{1,8}(\.\d{1,2})?$/,
    "Use an amount with up to two decimal places",
  );
const discount = amount.refine(
  (v) => !v.startsWith("-"),
  "Record discounts as non-negative reductions",
);
export const price = z
  .string()
  .regex(/^\d{1,8}(\.\d{1,4})?$/, "Use a non-negative decimal price");
const positive = z
  .string()
  .regex(/^\d{1,8}(\.\d{1,4})?$/)
  .refine((v) => !/^0*(\.0*)?$/.test(v), "Must be greater than zero");
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Use a valid date",
  );
const unit = z.enum(["g", "kg", "ml", "l", "count"]);
const channel = z.enum([
  "in-store",
  "online pickup",
  "online delivery",
  "unspecified",
]);
const url = z
  .url()
  .refine(
    (v) => ["http:", "https:"].includes(new URL(v).protocol),
    "Use an http or https source link",
  );
export const lineSchema = z.object({
  id: z.uuid().optional(),
  original_text: z.string().max(500),
  item_name: z.string().max(160),
  category: z.string().min(1).max(60),
  comparison_group: z.string().max(160),
  quantity: optional(positive),
  package_size: optional(positive),
  unit: optional(unit),
  discount: optional(discount),
  line_amount: optional(amount),
  regular_price: optional(price),
  sale_price: optional(price),
  uncertain: z.boolean(),
});
export const reviewSchema = z.object({
  version: z.number().int().nonnegative(),
  confirm: z.boolean(),
  draft: z.object({
    store_name: optional(z.string().max(160)),
    branch_id: optional(z.uuid()),
    purchase_date: optional(date),
    subtotal: optional(amount),
    tax: optional(amount),
    receipt_discount: optional(discount),
    fees: optional(amount),
    total: optional(amount),
    notes: optional(z.string().max(2000)),
    acknowledged_difference: z.boolean(),
    lines: z.array(lineSchema).max(300),
  }),
});
export const observationSchema = z.object({
  item_id: z.uuid(),
  branch_id: optional(z.uuid()),
  store_name: optional(z.string().max(160)),
  observed_on: date,
  price,
  package_size: optional(positive),
  unit: optional(unit),
  regular_price: optional(price),
  sale_price: optional(price),
  source_url: optional(url),
  channel,
  conditions: z.string().max(1000),
});
export const offerSchema = z
  .object({
    item_id: z.uuid(),
    branch_ids: z.array(z.uuid()).min(1).max(30),
    price,
    package_size: optional(positive),
    unit: optional(unit),
    regular_price: optional(price),
    valid_from: date,
    valid_to: date,
    source_url: url,
    channel,
    conditions: z.string().max(1000),
  })
  .refine(
    (v) => v.valid_to >= v.valid_from,
    "Offer expiry must be on or after its start date",
  );
export const offersSchema = z.array(offerSchema).min(1).max(500);
