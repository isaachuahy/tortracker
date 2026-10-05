import { authenticated, errorResponse, workspace } from "@/lib/api";
import { NextResponse } from "next/server";
export async function GET() {
  try {
    const { db } = await authenticated();
    return NextResponse.json(await workspace(db), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
