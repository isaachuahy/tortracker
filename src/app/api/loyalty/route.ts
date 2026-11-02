import { authenticated, checkOrigin, errorResponse, HttpError } from "@/lib/api";
import { loyaltyImportSchema, MAX_LOYALTY_IMPORT_BYTES } from "@/lib/loyalty";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
const privateHeaders = { "Cache-Control": "private, no-store" };

export async function GET() {
  try {
    const { db } = await authenticated();
    const [offers, transactions] = await Promise.all([
      db.from("loyalty_offers_read").select("*").order("observed_at", { ascending: false }),
      db.from("loyalty_transactions_read").select("*").order("observed_at", { ascending: false }),
    ]);
    if (offers.error) throw offers.error;
    if (transactions.error) throw transactions.error;
    return NextResponse.json({ offers: offers.data, transactions: transactions.data }, { headers: privateHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    checkOrigin(request);
    const { db } = await authenticated();
    const reader = request.body?.getReader();
    if (!reader) throw new HttpError(400, "Provide a JSON loyalty import.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_LOYALTY_IMPORT_BYTES) {
          await reader.cancel();
          throw new HttpError(413, "Choose a loyalty JSON file under 2 MiB.");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    let body: unknown;
    try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw new HttpError(400, "Provide a valid JSON loyalty import."); }
    const input = loyaltyImportSchema.parse(body);
    const result = await db.rpc("import_loyalty", { p_data: input });
    if (result.error) throw result.error;
    return NextResponse.json(result.data, { status: 201, headers: privateHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
