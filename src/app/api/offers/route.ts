import { authenticated, checkOrigin, errorResponse } from "@/lib/api";
import { offersSchema } from "@/lib/validation";
import { NextRequest, NextResponse } from "next/server";
export async function POST(request: NextRequest) {
  try {
    checkOrigin(request);
    const { db } = await authenticated();
    const result = await db.rpc("import_offers", {
      p_rows: offersSchema.parse(await request.json()),
    });
    if (result.error) throw result.error;
    return NextResponse.json({ count: result.data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
