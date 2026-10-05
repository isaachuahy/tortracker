import Decimal from "decimal.js";
import type { Line, Receipt, Unit } from "./types";
Decimal.set({ precision: 32, rounding: Decimal.ROUND_HALF_UP });
export function money(value: string | null | undefined) {
  if (value == null || value === "") return "Unknown";
  const decimal = new Decimal(value);
  return (decimal.isNegative() ? "-$" : "$") + decimal.abs().toFixed(2);
}
export function sum(values: (string | null | undefined)[]): string {
  return values
    .reduce<Decimal>(
      (total, value) =>
        value == null || value === "" ? total : total.add(value),
      new Decimal(0),
    )
    .toFixed(2);
}
export function comparable(
  price: string,
  size: string | null,
  unit: Unit | null,
): { value: Decimal; unit: string } | null {
  if (!size || !unit || new Decimal(size).lte(0)) return null;
  const standardSize = new Decimal(size).div(
    unit === "g" || unit === "ml" ? 1000 : 1,
  );
  return {
    value: new Decimal(price).div(standardSize),
    unit:
      unit === "g" || unit === "kg"
        ? "kg"
        : unit === "ml" || unit === "l"
          ? "L"
          : "each",
  };
}
export function reconciliation(
  receipt: Pick<
    Receipt,
    "subtotal" | "tax" | "total" | "receipt_discount" | "fees"
  >,
  lines: Line[],
) {
  const issues: string[] = [];
  if (
    !lines.length ||
    lines.some((line) => line.line_amount == null || line.line_amount === "")
  )
    issues.push("Some item amounts are unknown.");
  if (receipt.subtotal == null || receipt.subtotal === "")
    issues.push("Subtotal is unknown.");
  else if (
    lines.every((line) => line.line_amount != null && line.line_amount !== "")
  ) {
    const difference = new Decimal(
      sum(lines.map((line) => line.line_amount)),
    ).minus(receipt.subtotal);
    if (!difference.isZero())
      issues.push(
        "Items differ from the subtotal by " +
          money(difference.toString()) +
          ".",
      );
  }
  if (receipt.tax == null || receipt.tax === "") issues.push("Tax is unknown.");
  if (receipt.total == null || receipt.total === "")
    issues.push("Total is unknown.");
  if (receipt.subtotal && receipt.tax && receipt.total) {
    const calculated = new Decimal(receipt.subtotal)
      .add(receipt.tax)
      .minus(receipt.receipt_discount || "0")
      .add(receipt.fees || "0");
    const difference = calculated.minus(receipt.total);
    if (!difference.isZero())
      issues.push(
        "Subtotal, tax, discounts and fees differ from the total by " +
          money(difference.toString()) +
          ".",
      );
  }
  return issues;
}
export function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
