import { authenticated, errorResponse, workspace } from "@/lib/api";
export async function GET() {
  try {
    const { db } = await authenticated();
    const data = await workspace(db);
    const receipts = new Map(
      data.receipts
        .filter((r) => r.status === "confirmed" && r.kind === "receipt")
        .map((r) => [r.id, r]),
    );
    const fields = [
      "date",
      "store",
      "item",
      "original_text",
      "category",
      "quantity",
      "package_size",
      "unit",
      "line_amount_paid",
      "item_discount",
      "receipt_total",
    ];
    const csvCell = (value: string | null | undefined) => {
      const text = value ?? "";
      const safe =
        /^[=+@\t\r-]/.test(text) && !/^-\d+(\.\d+)?$/.test(text)
          ? "'" + text
          : text;
      return '"' + safe.replaceAll('"', '""') + '"';
    };
    const rows = data.lines
      .filter((l) => receipts.has(l.receipt_id!))
      .map((l) => {
        const r = receipts.get(l.receipt_id!)!;
        return [
          r.purchase_date,
          r.store_name,
          l.item_name,
          l.original_text,
          l.category,
          l.quantity,
          l.package_size,
          l.unit,
          l.line_amount,
          l.discount,
          r.total,
        ]
          .map(csvCell)
          .join(",");
      });
    return new Response([fields.join(","), ...rows].join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="tortracker-spending.csv"',
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
