import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import Papa from "papaparse";
import { z } from "zod";

export const MAX_FEED_BYTES = 2 * 1024 * 1024;
export const MAX_FEED_ROWS = 500;
const FEED_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

export class FlyerFeedError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "FlyerFeedError";
    this.status = status;
  }
}

const requiredHeaders = [
  "item_name", "store_branch", "price", "package_size", "unit",
  "valid_from", "valid_to", "source_url", "channel", "conditions",
] as const;
const optionalHeaders = [
  "regular_price", "starts_at", "ends_at", "points", "loyalty_program", "source_id",
] as const;
const allowedHeaders = new Set<string>([...requiredHeaders, ...optionalHeaders]);
const decimal = z.string().regex(/^\d{1,8}(\.\d{1,4})?$/, "Use a non-negative decimal with up to four decimal places");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
  value => !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value,
  "Use a valid calendar date",
);
const timestamp = z.string().datetime({ offset: true });
const blankToNull = (value: unknown) => value === "" || value === undefined ? null : value;
const optionalText = <T extends z.ZodType>(schema: T) => z.preprocess(blankToNull, schema.nullable());
const sourceUrl = z.url().max(2048).refine(value => ["https:", "http:"].includes(new URL(value).protocol), "Use an HTTP or HTTPS source link");

const feedRowSchema = z.object({
  item_name: z.string().min(1).max(160),
  store_branch: z.string().min(1).max(160),
  price: decimal,
  regular_price: optionalText(decimal),
  package_size: optionalText(decimal.refine(value => Number(value) > 0, "Package size must be greater than zero")),
  unit: optionalText(z.enum(["g", "kg", "ml", "l", "count"])),
  valid_from: date,
  valid_to: date,
  source_url: sourceUrl,
  channel: z.enum(["in-store", "online pickup", "online delivery", "unspecified"]),
  conditions: z.string().max(1000),
  starts_at: optionalText(timestamp),
  ends_at: optionalText(timestamp),
  points: z.preprocess(value => value === "" || value == null ? 0 : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value, z.number().int().min(0).max(2147483647)),
  loyalty_program: optionalText(z.literal("PC Optimum")),
  source_id: optionalText(z.string().min(1).max(250)),
}).strict().superRefine((row, context) => {
  if (row.valid_to < row.valid_from)
    context.addIssue({ code: "custom", path: ["valid_to"], message: "Expiry must be on or after the start date" });
  if ((row.package_size === null) !== (row.unit === null))
    context.addIssue({ code: "custom", path: ["package_size"], message: "Provide both package_size and unit, or leave both blank" });
  if ((row.starts_at === null) !== (row.ends_at === null))
    context.addIssue({ code: "custom", path: ["starts_at"], message: "Provide both starts_at and ends_at, or leave both blank" });
  if (row.starts_at && row.ends_at && Date.parse(row.ends_at) <= Date.parse(row.starts_at))
    context.addIssue({ code: "custom", path: ["ends_at"], message: "The exclusive end time must be later than the start time" });
  if (row.points > 0 && !row.loyalty_program)
    context.addIssue({ code: "custom", path: ["loyalty_program"], message: "Points require loyalty_program PC Optimum" });
});

export type FlyerRow = z.infer<typeof feedRowSchema>;
type NamedRecord = { id: string; name: string };

/** Parse only a normalized, bounded provider feed; never guess retailer-specific fields. */
export function parseFlyerFeed(text: string, contentType = "", defaultLoyaltyProgram?: "PC Optimum"): FlyerRow[] {
  if (Buffer.byteLength(text, "utf8") > MAX_FEED_BYTES)
    throw new FlyerFeedError(422, "The flyer feed exceeds the 2 MiB limit. Ask the provider to reduce its size.");
  const input = text.replace(/^\uFEFF/, "").trim();
  let rawRows: unknown[];
  if (contentType.toLowerCase().includes("json") || input.startsWith("[") || input.startsWith("{")) {
    let decoded: unknown;
    try { decoded = JSON.parse(input); }
    catch { throw new FlyerFeedError(422, "The flyer feed is not valid JSON."); }
    rawRows = Array.isArray(decoded) ? decoded : typeof decoded === "object" && decoded !== null && "offers" in decoded && Array.isArray(decoded.offers) ? decoded.offers : [];
    if (!Array.isArray(decoded) && !(typeof decoded === "object" && decoded !== null && "offers" in decoded && Array.isArray(decoded.offers)))
      throw new FlyerFeedError(422, "The JSON flyer feed must be an array of offers or an object with an offers array.");
  } else {
    const parsed = Papa.parse<Record<string, unknown>>(input, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: value => value.trim(),
    });
    if (parsed.errors.length || (parsed.meta.renamedHeaders && Object.keys(parsed.meta.renamedHeaders).length))
      throw new FlyerFeedError(422, "The CSV flyer feed has malformed rows or duplicate headers. Check quoting and column counts.");
    const headers = parsed.meta.fields ?? [];
    const missing = requiredHeaders.filter(header => !headers.includes(header));
    const unknown = headers.filter(header => !allowedHeaders.has(header));
    if (missing.length)
      throw new FlyerFeedError(422, `The flyer feed is missing columns: ${missing.join(", ")}.`);
    if (unknown.length)
      throw new FlyerFeedError(422, "The flyer feed has unsupported columns. Use the documented normalized headers.");
    rawRows = parsed.data;
  }
  if (!rawRows.length || rawRows.length > MAX_FEED_ROWS)
    throw new FlyerFeedError(422, "The flyer feed must contain between 1 and 500 offers.");
  return rawRows.map((row, index) => {
    if (typeof row !== "object" || row === null || Array.isArray(row))
      throw new FlyerFeedError(422, `Flyer row ${index + 1} must be an object.`);
    // Trim names/CSV values but preserve prices as decimal strings at the API boundary.
    const values = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value]));
    if (defaultLoyaltyProgram && (values.loyalty_program == null || values.loyalty_program === ""))
      values.loyalty_program = defaultLoyaltyProgram;
    if (Object.keys(values).some(key => !allowedHeaders.has(key)))
      throw new FlyerFeedError(422, `Flyer row ${index + 1} has unsupported fields. Use the documented normalized field names.`);
    const parsed = feedRowSchema.safeParse(values);
    if (!parsed.success) {
      const issues = parsed.error.issues.slice(0, 3).map(issue => `${issue.path.join(".") || "row"}: ${issue.message}`).join("; ");
      throw new FlyerFeedError(422, `Flyer row ${index + 1}: ${issues}.`);
    }
    return parsed.data;
  });
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function flyerSourceProvider(configuredUrl: URL, postalCode?: string): string {
  return `flyer-feed:${hash([configuredUrl.href, postalCode ?? null])}`;
}

export function resolveFlyerFeedUrl(template: string, postalCode?: string | null) {
  const canonical = postalCode?.replace(/\s/g, "").toUpperCase() || undefined;
  if (canonical && !/^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/.test(canonical))
    throw new FlyerFeedError(422, "Save a valid Canadian postal code in Sources before importing local flyers.");
  if (template.includes("{postal_code}") && !canonical)
    throw new FlyerFeedError(422, "Save your postal code in Sources before importing local flyers.");
  const url = template.replaceAll("{postal_code}", encodeURIComponent(canonical ?? ""));
  return { url, postalCode: canonical };
}

/** Match exact existing names; ambiguity is an error, never a guessed branch. */
export function mapFlyerOffers(rows: FlyerRow[], items: NamedRecord[], stores: NamedRecord[], sourceProvider: string) {
  const match = (records: NamedRecord[], name: string, kind: string, row: number) => {
    const matches = records.filter(record => record.name === name);
    if (matches.length !== 1)
      throw new FlyerFeedError(422, `Flyer row ${row}: ${matches.length ? "ambiguous" : "unknown"} ${kind} “${name}”. Use an exact, unique ${kind} name from the tracker.`);
    return matches[0].id;
  };
  const seen = new Map<string, string>();
  return rows.flatMap((row, index) => {
    const itemId = match(items, row.item_name, "item", index + 1);
    const branchId = match(stores, row.store_branch, "store branch", index + 1);
    const sourceId = row.source_id ?? `row:${hash([
      sourceProvider, row.item_name, row.store_branch, row.package_size, row.unit,
      row.valid_from, row.valid_to, row.starts_at, row.ends_at,
      row.channel, row.source_url, row.loyalty_program,
    ])}`;
    const offer = {
      item_id: itemId,
      branch_ids: [branchId],
      price: row.price,
      regular_price: row.regular_price,
      package_size: row.package_size,
      unit: row.unit,
      valid_from: row.valid_from,
      valid_to: row.valid_to,
      source_url: row.source_url,
      channel: row.channel,
      conditions: row.conditions,
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      points: row.points,
      loyalty_program: row.loyalty_program,
      source_provider: sourceProvider,
      source_id: sourceId,
    };
    const value = JSON.stringify(offer);
    const prior = seen.get(sourceId);
    if (prior && prior !== value)
      throw new FlyerFeedError(422, `Flyer row ${index + 1} repeats a source_id with different offer details. Give each offer and branch a unique source_id.`);
    seen.set(sourceId, value);
    return prior ? [] : [offer];
  });
}

/** Conservative public-address check, including mapped IPv4 and IPv6 special ranges. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  if (family !== 6 || address.includes("%")) return false;
  const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1).toLowerCase();
  // Globally routable unicast is within 2000::/3. Exclude transition/documentation ranges.
  const [first, second = "0"] = normalized.split(":");
  const prefix = parseInt(second || "0", 16);
  return /^[23]/.test(normalized) && !(first === "2001" && (prefix <= 0x1ff || prefix === 0xdb8)) &&
    first !== "2002" && !(first === "3fff" && prefix <= 0xfff);
}

export function validateFeedUrl(value: string, originalOrigin?: string): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new FlyerFeedError(503, "FLYER_FEED_URL must be a valid public HTTPS URL."); }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (url.protocol !== "https:" || url.username || url.password || url.hash || (url.port && url.port !== "443") ||
      hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal") || !hostname.includes(".") && !isIP(hostname) ||
      isIP(hostname) && !isPublicAddress(hostname))
    throw new FlyerFeedError(503, "The flyer feed must use a public HTTPS URL on port 443, without URL credentials or a fragment.");
  if (originalOrigin && url.origin !== originalOrigin)
    throw new FlyerFeedError(502, "The flyer feed redirected to a different origin. Update the configured feed URL with the provider.");
  return url;
}

type FeedResponse = { status: number; location?: string; body: string; contentType: string };

async function requestFeed(url: URL, token: string | undefined, signal: AbortSignal): Promise<FeedResponse> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (signal.aborted) throw signal.reason;
  if (!addresses.length || addresses.some(entry => !isPublicAddress(entry.address)))
    throw new FlyerFeedError(502, "The flyer feed resolves to a non-public destination. Check the provider configuration.");
  const address = addresses[0];
  return new Promise((resolve, reject) => {
    // Pin the validated result in the connection lookup, avoiding a second DNS resolution.
    const request = httpsRequest(url, {
      method: "GET",
      agent: false,
      signal,
      headers: {
        Accept: "application/json, text/csv;q=0.9",
        "Accept-Encoding": "identity",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      },
    }, response => {
      const status = response.statusCode ?? 502;
      const location = response.headers.location;
      if (status >= 300 && status < 400) {
        response.destroy();
        resolve({ status, location, body: "", contentType: "" });
        return;
      }
      if (status !== 200) {
        response.destroy();
        reject(new FlyerFeedError(502, `The flyer provider returned HTTP ${status}. Check its availability and the server feed credentials.`));
        return;
      }
      const declaredLength = Number(response.headers["content-length"] ?? 0);
      if (declaredLength > MAX_FEED_BYTES) {
        response.destroy();
        reject(new FlyerFeedError(502, "The flyer feed exceeds the 2 MiB download limit."));
        return;
      }
      const encoding = response.headers["content-encoding"];
      if (encoding && encoding !== "identity") {
        response.destroy();
        reject(new FlyerFeedError(502, "The flyer provider must send uncompressed JSON or CSV."));
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_FEED_BYTES) {
          response.destroy(new FlyerFeedError(502, "The flyer feed exceeds the 2 MiB download limit."));
          return;
        }
        chunks.push(chunk);
      });
      response.once("error", reject);
      response.once("end", () => resolve({ status, body: Buffer.concat(chunks).toString("utf8"), contentType: response.headers["content-type"] ?? "" }));
    });
    request.once("error", reject);
    request.end();
  });
}

/** Server-only configured feed; client requests cannot supply a destination. */
export async function fetchFlyerFeed(configuredUrl: string, token?: string, postalCode?: string) {
  const initial = validateFeedUrl(configuredUrl);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new FlyerFeedError(504, "The flyer provider did not respond within 15 seconds. Please try again later."));
    }, FEED_TIMEOUT_MS);
  });
  const download = async () => {
    let current = initial;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const response = await requestFeed(current, token, controller.signal);
      if (response.status === 200)
        return { rows: parseFlyerFeed(response.body, response.contentType), sourceProvider: flyerSourceProvider(initial, postalCode) };
      if (!response.location || redirects === MAX_REDIRECTS)
        throw new FlyerFeedError(502, "The flyer feed has an invalid or excessive redirect chain.");
      current = validateFeedUrl(new URL(response.location, current).href, initial.origin);
    }
    throw new FlyerFeedError(502, "The flyer feed could not be downloaded.");
  };
  try {
    return await Promise.race([download(), timeout]);
  } catch (error) {
    if (error instanceof FlyerFeedError) throw error;
    if (controller.signal.aborted)
      throw new FlyerFeedError(504, "The flyer provider did not respond within 15 seconds. Please try again later.");
    throw new FlyerFeedError(502, "The flyer feed could not be reached. Check the server feed configuration and provider availability.");
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
