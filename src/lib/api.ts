import { serverClient } from "./supabase-server";
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import type { Workspace } from "./types";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function authenticated() {
  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) throw new HttpError(401, "Please sign in.");
  return { db, user };
}
export function checkOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const allowed = process.env.APP_URL
    ? new URL(process.env.APP_URL).origin
    : request.nextUrl.origin;
  if (origin !== allowed && origin !== request.nextUrl.origin)
    throw new HttpError(403, "Request origin is not allowed.");
}
export function errorResponse(error: unknown) {
  if (error instanceof ZodError)
    return NextResponse.json(
      {
        error: error.issues
          .map((issue) => issue.path.join(".") + ": " + issue.message)
          .join("; "),
      },
      { status: 400 },
    );
  if (error instanceof HttpError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  // Postgres RPC errors contain deliberately written user-facing messages, not provider responses.
  const candidate = error as { code?: string; message?: string };
  if (candidate?.code === "P0001")
    return NextResponse.json({ error: candidate.message }, { status: 409 });
  if (candidate?.code?.startsWith("22") || candidate?.code?.startsWith("23")) {
    return NextResponse.json(
      {
        error:
          "Some values are invalid. Check dates, amounts, items and branches.",
      },
      { status: 400 },
    );
  }
  return NextResponse.json(
    { error: "The request could not be completed. Please try again." },
    { status: 500 },
  );
}
export async function workspace(
  db: Awaited<ReturnType<typeof serverClient>>,
): Promise<Workspace> {
  const results = await Promise.all([
    db
      .from("receipts_read")
      .select("*")
      .order("created_at", { ascending: false }),
    db.from("lines_read").select("*").order("position"),
    db.from("items").select("*").order("name"),
    db.from("stores").select("*").order("name"),
    db
      .from("observations_read")
      .select("*")
      .order("observed_on", { ascending: false }),
    db.from("offers_read").select("*").order("valid_to"),
    db.from("offer_stores").select("*"),
  ]);
  for (const result of results) if (result.error) throw result.error;
  const names = [
    "receipts",
    "lines",
    "items",
    "stores",
    "observations",
    "offers",
    "offer_stores",
  ];
  return Object.fromEntries(
    results.map((result, index) => [names[index], result.data]),
  ) as Workspace;
}
