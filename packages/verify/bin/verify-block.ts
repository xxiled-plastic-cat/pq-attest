import { readFileSync } from "node:fs";
import { verifyBlockOffline, verifyInclusionOffline } from "../../../src/block/verify.ts";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run verify:block -- <bundle-or-proof.json>");
  process.exit(2);
}

const body: unknown = JSON.parse(readFileSync(file, "utf8"));
const record = body && typeof body === "object" ? (body as { schema?: string }) : {};
const report = record.schema === "tx-inclusion-v1" ? verifyInclusionOffline(body) : verifyBlockOffline(body);
for (const check of report.checks) {
  console.log(`${check.ok ? "pass" : "fail"} ${check.name}: ${check.reason}`);
}
process.exit(report.ok ? 0 : 1);
