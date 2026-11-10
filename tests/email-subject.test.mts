// Pure unit test, no DB:  npx tsx tests/email-subject.test.mts
// Olivier 2026-11-09: subject "Social.gershon.ai — <Company> — <Type> report", sender name "Social.gershon.ai".
import * as SM from "../src/lib/email/subject.ts";
import * as FM from "../src/lib/email/sender.ts";
const S = ((SM as any).default ?? SM) as typeof SM;
const F = ((FM as any).default ?? FM) as typeof FM;
let pass = 0, fail = 0;
const eq = (a: unknown, b: unknown, m: string) => { if (a === b) { pass++; console.log("  ✓", m); } else { fail++; console.log("  ✗", m, "→", a); } };

eq(S.socialSubject("WALLIX", "Company report"), "Social.gershon.ai — WALLIX — Company report", "company report");
eq(S.socialSubject("Gershon Consulting", S.categoryReportType("CLIENT")), "Social.gershon.ai — Gershon Consulting — Client report", "client report");
eq(S.socialSubject("Gershon Consulting", S.categoryReportType("COMPETITION")), "Social.gershon.ai — Gershon Consulting — Competitive report", "competitive report");
eq(S.socialSubject(undefined, "Posting report"), "Social.gershon.ai — Gershon Consulting — Posting report", "missing company falls back");
eq(F.withGcName("GC Social <reports@gershon.ai>"), "Social.gershon.ai <reports@gershon.ai>", "GC Social renamed");
eq(F.withGcName("Social · Gershon.AI <reports@gershon.ai>"), "Social.gershon.ai <reports@gershon.ai>", "client sender renamed");
eq(F.withGcName("social@gershon.ai"), "Social.gershon.ai <social@gershon.ai>", "bare address gets the name");
eq(F.resolveFrom(), "Social.gershon.ai <social@gershon.ai>", "default sender");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
