import assert from "node:assert/strict";
import * as m from "../src/lib/matrix/social-grade";
const gradeSocial: typeof import("../src/lib/matrix/social-grade").gradeSocial = (m as any).gradeSocial ?? (m as any).default?.gradeSocial;

const now = new Date("2026-11-23T22:00:00Z");
const h = (n: number) => new Date(now.getTime() - n * 3600e3);

// red: fewer than 10 companies, even if collecting
let g = gradeSocial({ companies: 9, covered: 9, posts30: 400, lastCollectedAt: h(1), now });
assert.equal(g.level, "red"); assert.equal(g.ok, false); assert.match(g.note, /9 companies watched \(need 10\)/);
assert.equal(gradeSocial({ companies: 0, covered: 0, posts30: 0, lastCollectedAt: null, now }).level, "red");

// orange: 10+ companies, nothing collected
g = gradeSocial({ companies: 12, covered: 0, posts30: 0, lastCollectedAt: null, now });
assert.equal(g.level, "orange"); assert.equal(g.ok, true); assert.equal(g.warn, true); assert.match(g.note, /nothing collected yet/);
// orange: collection stopped (last run 3 days ago)
g = gradeSocial({ companies: 12, covered: 10, posts30: 200, lastCollectedAt: h(72), now });
assert.equal(g.level, "orange"); assert.match(g.note, /last collected 3d ago/);
// orange: fresh but most companies not covered
g = gradeSocial({ companies: 20, covered: 9, posts30: 50, lastCollectedAt: h(2), now });
assert.equal(g.level, "orange"); assert.match(g.note, /only 9 of 20 collecting/);

// green: 10+ companies, fresh, half covered
g = gradeSocial({ companies: 10, covered: 5, posts30: 120, lastCollectedAt: h(47), now });
assert.equal(g.level, "green"); assert.equal(g.warn, false); assert.match(g.note, /10 companies · 120 posts \(30d\) · collecting/);

// note never starts with "0 " followed by posts/collected (the matrix would force it red)
assert.doesNotMatch(gradeSocial({ companies: 10, covered: 0, posts30: 0, lastCollectedAt: null, now }).note, /^0 (collected|posts)/);
console.log("social-grade: ok");
