import { createClient } from "@supabase/supabase-js";
process.loadEnvFile(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname))
  throw new Error("Seeding is restricted to local Supabase.");
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});
const password = "Tortracker-local-2026!";
for (const email of [
  "desktop@example.test",
  "mobile@example.test",
  "other@example.test",
  "isaac@example.test",
]) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 100 });
  const existing = data.users.find((u) => u.email === email);
  if (existing) {
    const { data: files } = await admin.storage
      .from("receipts")
      .list(existing.id, { limit: 1000 });
    if (files?.length)
      await admin.storage
        .from("receipts")
        .remove(files.map((f) => existing.id + "/" + f.name));
    const deleted = await admin.auth.admin.deleteUser(existing.id);
    if (deleted.error) throw deleted.error;
  }
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error) throw created.error;
}
console.log(
  "Local test accounts provisioned. Use isaac@example.test and the password documented in README.",
);
