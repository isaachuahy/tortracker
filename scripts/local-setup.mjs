import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const status = spawnSync(
  "node_modules/.bin/supabase",
  ["status", "-o", "json"],
  { encoding: "utf8" },
);
if (status.status !== 0) {
  console.error("Start local Supabase first: npx supabase start");
  process.exit(1);
}
const data = JSON.parse(status.stdout);
const url = data.API_URL;
if (!url || !["localhost", "127.0.0.1"].includes(new URL(url).hostname))
  throw new Error("Local setup requires a loopback Supabase instance.");
const env = {
  NEXT_PUBLIC_SUPABASE_URL: url,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: data.PUBLISHABLE_KEY,
  SUPABASE_SECRET_KEY: data.SECRET_KEY,
  APP_URL: "http://127.0.0.1:3000",
};
if (!env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || !env.SUPABASE_SECRET_KEY)
  throw new Error(
    "Local Supabase did not return publishable and secret keys. Update the Supabase CLI and restart the local stack.",
  );
mkdirSync(".local", { recursive: true });
writeFileSync(
  ".env.local",
  Object.entries(env)
    .map(([key, value]) => key + "=" + value)
    .join("\n") + "\n",
  { mode: 0o600 },
);
console.log(
  "Local environment saved to .env.local. No hosted project was changed.",
);
