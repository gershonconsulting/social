import assert from "node:assert/strict";
import * as M0 from "../src/lib/workspaces/competitor-transfer-core.ts";
const M = ((M0 as any).default ?? M0) as typeof M0;

const ws = [
  { id: "v", name: "VALOS S.r.l.", clientType: "INTERNAL" },
  { id: "q", name: "Quanticate", clientType: "COMPETITION" },
  { id: "p", name: "Partner X", clientType: "PARTNER" },
];
// mirror link wins
assert.equal(M.pickTargetCompany({ sourceId: "g1", sourceName: "Other", mirrorSourceByTarget: new Map([["p", "g1"]]), companies: ws }).company?.id, "p");
// name match with suffix stripped
assert.equal(M.pickTargetCompany({ sourceId: "g1", sourceName: "VALOS", mirrorSourceByTarget: new Map(), companies: ws }).company?.id, "v");
// explicit id not present -> null
assert.equal(M.pickTargetCompany({ sourceId: "g1", sourceName: "VALOS", explicitId: "zz", mirrorSourceByTarget: new Map(), companies: ws }).company, null);
// never picks a competitor by name
assert.equal(M.pickTargetCompany({ sourceId: "g1", sourceName: "Quanticate", mirrorSourceByTarget: new Map(), companies: ws }).company?.id, "v");
// prefix: "Amphasys" vs "Amphasys AG Bioprocessing"
const ws2 = [{ id: "a", name: "Amphasys Bioprocessing", clientType: "CLIENT" }, { id: "b", name: "Lonza", clientType: "COMPETITION" }];
assert.equal(M.pickTargetCompany({ sourceId: "s", sourceName: "Amphasys", mirrorSourceByTarget: new Map(), companies: ws2 }).company?.id, "a");
// nothing matches, no single internal -> null
assert.equal(M.pickTargetCompany({ sourceId: "s", sourceName: "WALLIX", mirrorSourceByTarget: new Map(), companies: ws2 }).company, null);
// reuse existing same-name competitor
assert.equal(M.findExistingByName("Quanticate Ltd", ws)?.id, "q");
assert.equal(M.normName("Ménard & Co."), "menard and");
// merge
assert.deepEqual(M.mergeCompetitorIds(["a", "b"], ["b", "c", "self"], "self"), ["a", "b", "c"]);
assert.equal(M.mergeCompetitorIds([], Array.from({ length: 40 }, (_, i) => "x" + i), "s").length, 25);
console.log("competitor-transfer: all assertions passed");
