import { execFileSync } from "node:child_process";
export default async function setup() {
  execFileSync(process.execPath, ["scripts/seed-local.mjs"], {
    stdio: "inherit",
  });
}
