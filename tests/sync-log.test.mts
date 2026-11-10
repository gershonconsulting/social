import assert from "node:assert/strict";
import * as M from "../src/lib/extension/sync-log-rows.ts";
const { buildSyncLogRows } = ((M as any).default ?? M) as typeof M;
const t0 = new Date("2026-11-09T19:00:00Z"), t1 = new Date("2026-11-09T19:00:05Z");
const rows = buildSyncLogRows("org1", [
  { clientId: "gc", platform: "LINKEDIN", attempted: 4, upserted: 4 },
  { clientId: "gc", platform: "TWITTER", attempted: 0, upserted: 0, error: "no x cookies" },
  { clientId: "lin", platform: "LINKEDIN", attempted: 2, upserted: 2 },
  { clientId: "bad", platform: "LINKEDIN", attempted: 0, upserted: 0, error: "FAIL" },
  { clientId: "?", platform: "?", attempted: 0, upserted: 0, error: "missing" },
  { clientId: "other", platform: "LINKEDIN", attempted: 0, upserted: 0, error: "client not in this workspace" },
], t0, t1, "0.26.0");
assert.equal(rows.length, 3);
const gc = rows.find((r) => r.clientId === "gc")!;
assert.equal(gc.status, "PARTIAL"); assert.equal(gc.itemsSucceeded, 4); assert.equal(gc.itemsFailed, 1);
assert.equal(gc.organizationId, "org1"); assert.ok(gc.notes.startsWith("Chrome extension collection"));
assert.equal(JSON.parse(gc.resultsJson).length, 2);
assert.equal(rows.find((r) => r.clientId === "lin")!.status, "COMPLETED");
assert.equal(rows.find((r) => r.clientId === "bad")!.status, "FAILED");
console.log("sync-log tests: 6/6 pass");
