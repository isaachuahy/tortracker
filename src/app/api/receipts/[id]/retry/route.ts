import { authenticated, checkOrigin, errorResponse } from "@/lib/api";
import { NextRequest, NextResponse } from "next/server";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    checkOrigin(request);
    const { db } = await authenticated();
    const { id } = await params;
    const result = await db.rpc("retry_receipt", { p_id: id });
    if (result.error) throw result.error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
