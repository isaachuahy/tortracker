import {
  authenticated,
  checkOrigin,
  errorResponse,
  HttpError,
} from "@/lib/api";
import { reviewSchema } from "@/lib/validation";
import { NextRequest, NextResponse } from "next/server";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: NextRequest, context: Context) {
  try {
    const { db } = await authenticated();
    const { id } = await context.params;
    const result = await db
      .from("receipts_read")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) throw new HttpError(404, "Receipt not found.");
    const [lines, job, file] = await Promise.all([
      db.from("lines_read").select("*").eq("receipt_id", id).order("position"),
      db
        .from("jobs")
        .select("status,attempts,last_error")
        .eq("receipt_id", id)
        .maybeSingle(),
      db.storage.from("receipts").createSignedUrl(result.data.file_path, 300),
    ]);
    if (lines.error) throw lines.error;
    return NextResponse.json(
      {
        receipt: result.data,
        lines: lines.data,
        job: job.data,
        file_url: file.data?.signedUrl,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: NextRequest, context: Context) {
  try {
    checkOrigin(request);
    const { db } = await authenticated();
    const { id } = await context.params;
    const { version, confirm, draft } = reviewSchema.parse(
      await request.json(),
    );
    const result = await db.rpc("save_receipt", {
      p_id: id,
      p_version: version,
      p_draft: draft,
      p_confirm: confirm,
    });
    if (result.error) throw result.error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
