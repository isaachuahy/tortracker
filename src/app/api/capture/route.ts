import {
  authenticated,
  checkOrigin,
  errorResponse,
  HttpError,
} from "@/lib/api";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    checkOrigin(request);
    const { db, user } = await authenticated();
    const form = await request.formData();
    const file = form.get("file");
    const captureId = z.uuid().parse(form.get("capture_id"));
    const kind = form.get("kind") === "shelf" ? "shelf" : "receipt";
    if (
      !(file instanceof File) ||
      file.size === 0 ||
      file.size > 10 * 1024 * 1024
    )
      throw new HttpError(400, "Choose a receipt photo or PDF up to 10 MB.");
    const bytes = Buffer.from(await file.arrayBuffer());
    const mime = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
      ? "image/jpeg"
      : bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? "image/png"
        : bytes.subarray(0, 4).toString() === "RIFF" &&
            bytes.subarray(8, 12).toString() === "WEBP"
          ? "image/webp"
          : bytes.subarray(0, 5).toString() === "%PDF-"
            ? "application/pdf"
            : null;
    if (!mime)
      throw new HttpError(400, "Supported files are JPG, PNG, WebP and PDF.");
    const path = user.id + "/" + captureId;
    const existing = await db
      .from("receipts_read")
      .select("id")
      .eq("file_path", path)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return NextResponse.json({ id: existing.data.id });
    const uploaded = await db.storage
      .from("receipts")
      .upload(path, bytes, { contentType: mime, upsert: false });
    if (uploaded.error) {
      const priorUpload = await db.storage.from("receipts").info(path);
      if (priorUpload.error) throw uploaded.error;
    }
    const queued = await db.rpc("queue_receipt", {
      p_path: path,
      p_name: file.name.slice(0, 250),
      p_mime: mime,
      p_kind: kind,
    });
    if (queued.error) {
      const queuedElsewhere = await db
        .from("receipts_read")
        .select("id")
        .eq("file_path", path)
        .maybeSingle();
      if (!queuedElsewhere.data)
        await db.storage.from("receipts").remove([path]);
      throw queued.error;
    }
    return NextResponse.json({ id: queued.data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
