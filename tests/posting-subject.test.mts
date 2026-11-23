import assert from "node:assert/strict";
import * as M from "../src/lib/reports/ops/posting-subject";
const { isoWeek, postingSubject } = ((M as any).isoWeek ? M : (M as any).default) as typeof M;
assert.equal(isoWeek("2026-11-15"), 46); // Sun ends W46
assert.equal(isoWeek("2026-11-09"), 46); // Mon starts W46
assert.equal(isoWeek("2026-11-22"), 47);
assert.equal(isoWeek("2026-01-01"), 1);
assert.equal(isoWeek("2025-12-29"), 1);
assert.equal(isoWeek("2027-01-03"), 53);
assert.equal(postingSubject({ dayKey: "2026-11-15" }, "Gershon Consulting"), "Social by Gershon.ai — Gershon Consulting — Master Posting report W46");
assert.equal(postingSubject({ dayKey: "2026-11-15" }), "Social by Gershon.ai — Gershon Consulting — Master Posting report W46");
console.log("ok: posting subject 8/8");
