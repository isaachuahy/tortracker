import { authenticated, checkOrigin, errorResponse, HttpError } from "@/lib/api";
import { fetchFlyerFeed, FlyerFeedError, mapFlyerOffers, resolveFlyerFeedUrl } from "@/lib/flyer-feed";
import { offersSchema } from "@/lib/validation";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  try {
    await authenticated();
    return NextResponse.json({ configured: Boolean(process.env.FLYER_FEED_URL?.trim()) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    checkOrigin(request);
    const { db } = await authenticated();
    const configuredUrl = process.env.FLYER_FEED_URL?.trim();
    if (!configuredUrl)
      throw new HttpError(503, "Flyer import is not configured. Set FLYER_FEED_URL to an authorized provider's normalized HTTPS feed on the server.");
    const settings = await db.from("grocery_settings").select("postal_code").maybeSingle();
    if (settings.error) throw settings.error;
    const feed = resolveFlyerFeedUrl(configuredUrl, settings.data?.postal_code || process.env.FLYER_POSTAL_CODE);
    const { rows, sourceProvider } = await fetchFlyerFeed(feed.url, process.env.FLYER_FEED_TOKEN, feed.postalCode);
    const [items, stores] = await Promise.all([
      db.from("items").select("id,name"),
      db.from("stores").select("id,name"),
    ]);
    if (items.error) throw items.error;
    if (stores.error) throw stores.error;
    const offers = mapFlyerOffers(rows, items.data ?? [], stores.data ?? [], sourceProvider);
    const result = await db.rpc("import_offers", { p_rows: offersSchema.parse(offers) });
    if (result.error) throw result.error;
    return NextResponse.json({ count: result.data }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof FlyerFeedError)
      return errorResponse(new HttpError(error.status, error.message));
    return errorResponse(error);
  }
}
