import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { authenticated, checkOrigin, errorResponse, HttpError } from "@/lib/api";
import { FlyerFeedError, MAX_FEED_BYTES, mapFlyerOffers, parseFlyerFeed } from "@/lib/flyer-feed";
import { offersSchema } from "@/lib/validation";

export const runtime = "nodejs";

/** Manual flyer and loyalty offers share the same validated, atomic import as feeds. */
export async function POST(request: NextRequest) {
  try {
    checkOrigin(request);
    const { db } = await authenticated();
    const provider = request.nextUrl.searchParams.get("provider");
    if (provider !== "flyer" && provider !== "pc-optimum")
      throw new HttpError(400, "Choose flyer or PC Optimum offers.");
    const reader = request.body?.getReader();
    if (!reader) throw new HttpError(400, "Choose a CSV or JSON file to import.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FEED_BYTES) {
        await reader.cancel();
        throw new HttpError(413, "Choose a CSV or JSON file under 2 MiB.");
      }
      chunks.push(value);
    }
    const rows = parseFlyerFeed(Buffer.concat(chunks).toString("utf8"), request.headers.get("content-type") ?? "",
      provider === "pc-optimum" ? "PC Optimum" : undefined);
    const [items, stores] = await Promise.all([
      db.from("items").select("id,name"), db.from("stores").select("id,name"),
    ]);
    if (items.error) throw items.error;
    if (stores.error) throw stores.error;
    // Retailers issue IDs within their own catalog. The same ID from another
    // retailer or branch must never replace an unrelated saved sale.
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const identity = JSON.stringify([new URL(row.source_url).origin, row.store_branch]);
      const namespace = `manual-${provider}:${createHash("sha256").update(identity).digest("hex")}`;
      const group = groups.get(namespace) ?? [];
      group.push(row);
      groups.set(namespace, group);
    }
    const mapped = [...groups].flatMap(([namespace, group]) =>
      mapFlyerOffers(group, items.data, stores.data, namespace));
    const result = await db.rpc("import_offers", { p_rows: offersSchema.parse(mapped) });
    if (result.error) throw result.error;
    return NextResponse.json({ count: result.data }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof FlyerFeedError) return NextResponse.json({ error: error.message }, { status: error.status });
    return errorResponse(error);
  }
}
