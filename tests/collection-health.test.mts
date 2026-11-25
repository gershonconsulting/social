// v4.87.0 — a tab closed under the collector is not "LinkedIn changed its pages".
//   tsx tests/collection-health.test.mts
import * as M from "../src/lib/collection-health-errors.ts";
const { isBrowserSideError, countsForLinkedInAlarm } = ((M as any).default ?? M) as typeof M;
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log("  ✓", m); } else { fail++; console.log("  ✗", m); } };
ok(isBrowserSideError("tabs.update failed: No tab with id: 542203786."), "closed tab is browser-side");
ok(isBrowserSideError("executeScript: Frame with ID 0 was removed."), "removed frame is browser-side");
ok(isBrowserSideError("executeScript: Cannot access contents of the page. Extension manifest must request permission to access the respective host."), "unscriptable page is browser-side");
ok(!isBrowserSideError("posts are on the page but none could be read (LinkedIn layout changed again)"), "layout change is NOT browser-side");
ok(!isBrowserSideError(null), "no error is not browser-side");
ok(countsForLinkedInAlarm(null), "success counts");
ok(countsForLinkedInAlarm("no posts found on the page (it may not have loaded)"), "empty page counts");
ok(!countsForLinkedInAlarm("PAGE_UNAVAILABLE: LinkedIn shows no company page"), "dead link does not count");
ok(!countsForLinkedInAlarm("tabs.update failed: No tab with id: 1."), "closed tab does not count");
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
