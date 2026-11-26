// v4.87.1 — the daily brief counts only its own workspace's collection runs and errors.
//   tsx tests/heartbeat-scope.test.mts
import * as H from "../src/lib/extension/heartbeat-core.ts";
import * as S from "../src/lib/reports/collection-scope.ts";
const { addRun, pickHeartbeat, parseHeartbeat, failedProfiles, emptyHeartbeat } = ((H as any).default ?? H) as typeof H;
const { errorConnectionsWhere, pageProblemsWhere, failedHint } = ((S as any).default ?? S) as typeof S;

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log("  ✓", m); } else { fail++; console.log("  ✗", m); } };
const dayOf = (iso: string) => iso.slice(0, 10);

// Same dead link failing in 3 runs: 3 attempts, 1 profile.
const hb = emptyHeartbeat();
for (let i = 0; i < 3; i++) addRun(hb, "2026-11-26", { attempted: 10, upserted: 10, failed: 2, failedKeys: ["c1|LINKEDIN", "c2|TWITTER"] }, "2026-11-26T10:00:00Z");
ok(hb.days["2026-11-26"].failed === 6, "failed attempts add up per run (6)");
ok(failedProfiles(hb.days["2026-11-26"]) === 2, "distinct failed profiles stay 2");
ok(failedProfiles({ runs: 1, attempted: 0, upserted: 0, failed: 5 }) === null, "old days without keys give null");
ok(hb.since === "2026-11-26T10:00:00Z", "since is stamped on first write");

// Keep window prunes old days.
const pr = emptyHeartbeat();
pr.days["2026-10-01"] = { runs: 1, attempted: 1, upserted: 1, failed: 1 };
addRun(pr, "2026-11-26", { attempted: 0, upserted: 0, failed: 0 }, "2026-11-26T10:00:00Z", new Set(["2026-11-26"]));
ok(!pr.days["2026-10-01"], "days outside the keep window are pruned");

// Workspace vs all-workspace rows.
const global = parseHeartbeat(JSON.stringify({ lastAt: "2026-11-27T09:00:00Z", days: {
  "2026-11-24": { runs: 13, attempted: 2149, upserted: 2149, failed: 51 },
  "2026-11-25": { runs: 20, attempted: 3000, upserted: 3000, failed: 60 },
  "2026-11-26": { runs: 9, attempted: 900, upserted: 900, failed: 30 },
} }));
const org = parseHeartbeat(JSON.stringify({ lastAt: "2026-11-26T08:00:00Z", since: "2026-11-25T23:00:00Z", days: {
  "2026-11-25": { runs: 1, attempted: 50, upserted: 50, failed: 1, failedKeys: ["x|LINKEDIN"] },
  "2026-11-26": { runs: 4, attempted: 400, upserted: 400, failed: 3, failedKeys: ["a|LINKEDIN", "b|TWITTER"] },
} }));
const pick = pickHeartbeat(org, global, dayOf);
ok(pick.days["2026-11-24"].failed === 51, "days before the workspace row use the all-workspace row");
ok(pick.days["2026-11-25"].failed === 60, "the partial first day uses the all-workspace row");
ok(pick.days["2026-11-26"].failed === 3, "days after use the workspace row only (not other workspaces' 30)");
const none = pickHeartbeat(emptyHeartbeat(), global, dayOf);
ok(none.days["2026-11-26"].failed === 30 && none.lastAt === global.lastAt, "no workspace row yet: unchanged behaviour");
ok(parseHeartbeat("{bad").lastAt === null, "corrupt row reads as empty");

// Brief lists only its own workspace's connections.
ok((errorConnectionsWhere("org_gc") as any).client.organizationId === "org_gc", "Connections in error scoped to the workspace");
const pw = pageProblemsWhere("org_gc") as any;
ok(pw.client.organizationId === "org_gc" && pw.platform === "LINKEDIN" && pw.OR.length === 2, "LinkedIn links to fix scoped to the workspace");
ok(failedHint(9).includes("9 distinct profiles") && failedHint(1).endsWith("1 distinct profile"), "hint gives distinct profiles");
ok(failedHint(null).includes("once per run"), "hint says the count is per run");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
