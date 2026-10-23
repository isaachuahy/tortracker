import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticated, checkOrigin, errorResponse } from "@/lib/api";

const settingsSchema = z.object({
  postal_code: z.string().transform(value => value.toUpperCase().replace(/\s/g, ""))
    .pipe(z.string().regex(/^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTVWXYZ]\d[ABCEGHJ-NPRSTVWXYZ]\d$/, "Use a valid Canadian postal code")),
});

export async function GET() {
  try {
    const { db } = await authenticated();
    const [settings, email, imports] = await Promise.all([
      db.from("grocery_settings").select("postal_code").maybeSingle(),
      db.from("email_import_sources").select("status,last_attempt_at,last_success_at,imported_count,scanned_count,last_error").order("last_attempt_at", { ascending: false }).limit(5),
      db.from("email_imports").select("id,receipt_id,source_url,imported_at").order("imported_at", { ascending: false }).limit(10),
    ]);
    for (const result of [settings, email, imports]) if (result.error) throw result.error;
    return NextResponse.json({
      postal_code: settings.data?.postal_code ?? process.env.FLYER_POSTAL_CODE ?? "",
      saved_location: Boolean(settings.data),
      email_sources: email.data,
      recent_imports: imports.data,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    checkOrigin(request);
    const { db } = await authenticated();
    const values = settingsSchema.parse(await request.json());
    const result = await db.rpc("save_grocery_settings", { p_postal_code: values.postal_code });
    if (result.error) throw result.error;
    return NextResponse.json(values, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
