// Only the external extraction service is replaced. The app, worker and Supabase remain real.
import http from "node:http";
const attempts = new Map();
const server = http.createServer(async (req, res) => {
  if (req.url === "/health") {
    res.end("ready");
    return;
  }
  if (req.url !== "/v1/responses") {
    res.writeHead(404).end();
    return;
  }
  let text = "";
  for await (const chunk of req) text += chunk;
  const body = JSON.parse(text);
  const metadata = JSON.parse(body.input[0].content[0].text);
  const name = metadata.filename;
  const count = (attempts.get(name) || 0) + 1;
  attempts.set(name, count);
  if (name.startsWith("retry") && count <= 3) {
    res
      .writeHead(503)
      .end(JSON.stringify({ error: "fixture extraction failure" }));
    return;
  }
  await new Promise((resolve) =>
    setTimeout(resolve, name.startsWith("crash") && count === 1 ? 10000 : 900),
  );
  const shelf = metadata.document_kind === "shelf";
  const unknown = name.startsWith("unknown");
  const missingAmount = name.startsWith("missing-amount");
  const refund = name.startsWith("refund");
  const discrepancy = name.startsWith("difference");
  const line = {
    original_text: "BANANA 500G",
    item_name: "Bananas",
    category: "Produce",
    comparison_group: "Bananas",
    quantity: unknown ? null : "1",
    package_size: unknown ? null : "500",
    unit: unknown ? null : "g",
    discount: null,
    line_amount: missingAmount ? null : refund ? "-2.50" : "2.50",
    regular_price: null,
    sale_price: null,
    uncertain: discrepancy,
  };
  const draft = {
    store_name: "Loblaws Queen West",
    purchase_date: shelf ? null : "2026-10-05",
    subtotal: shelf ? null : refund ? "-2.50" : "2.50",
    tax: shelf ? null : "0.00",
    receipt_discount: null,
    fees: null,
    total: shelf ? null : refund ? "-2.50" : discrepancy ? "3.50" : "2.50",
    uncertain_fields: discrepancy
      ? ["Receipt total"]
      : shelf
        ? ["Observation date"]
        : [],
    notes: null,
    lines: [line],
  };
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      output: [
        { content: [{ type: "output_text", text: JSON.stringify(draft) }] },
      ],
    }),
  );
});
server.listen(4011, "127.0.0.1", () => console.log("Extraction fixture ready"));
