import assert from "node:assert/strict";
import * as lp from "../src/lib/linkedin-page.ts";
const parseLinkedInPage = ((lp as any).parseLinkedInPage ?? (lp as any).default?.parseLinkedInPage) as typeof import("../src/lib/linkedin-page.ts").parseLinkedInPage;

assert.deepEqual(parseLinkedInPage("https://www.linkedin.com/showcase/amphasys-bioprocessing/"), { kind: "showcase", vanity: "amphasys-bioprocessing" });
assert.deepEqual(parseLinkedInPage("https://www.linkedin.com/company/gershonconsulting"), { kind: "company", vanity: "gershonconsulting" });
assert.deepEqual(parseLinkedInPage("https://linkedin.com/in/oattia/?x=1"), { kind: "in", vanity: "oattia" });
assert.deepEqual(parseLinkedInPage("https://www.linkedin.com/school/hec-paris/"), { kind: "school", vanity: "hec-paris" });
assert.equal(parseLinkedInPage("https://x.com/foo"), null);
assert.equal(parseLinkedInPage(null), null);
console.log("linkedin-page: ok");
