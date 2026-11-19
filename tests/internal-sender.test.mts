// v4.80.1 (nightly 2026-11-19): GC sender name on internal-only emails; client emails untouched.
// Run: npx tsx tests/internal-sender.test.mts
import assert from "node:assert/strict";
import * as S from "../src/lib/email/sender.ts";
import * as B from "../src/lib/mail-bcc.ts";
const F = ((S as any).default ?? S) as typeof S;
const M = ((B as any).default ?? B) as typeof B;

const SOC = "Social.gershon.ai <reports@gershon.ai>";
const TP = "Talking Points <talkingpoints@gershon.ai>";

// Internal recipients -> GC name, address kept.
assert.equal(F.internalSender(SOC, ["report@gershonconsulting.com", "aina.rama@gershonconsulting.com"]), "GC Social <reports@gershon.ai>");
assert.equal(F.internalSender(SOC, "social@gershonconsulting.com"), "GC Social <reports@gershon.ai>");
assert.equal(F.internalSender(TP, ["olivier@gershonconsulting.com"]), "GC Talking Points <talkingpoints@gershon.ai>");
assert.equal(F.internalSender(F.resolveFrom(), ["Report <report@gershonconsulting.com>"]), "GC Social <social@gershon.ai>");

// Any outside recipient (To or Cc) -> sender unchanged (client e-mails).
assert.equal(F.internalSender(SOC, ["client@wallix.com"]), SOC);
assert.equal(F.internalSender(SOC, ["report@gershonconsulting.com", "anne@altavia.com"]), SOC);
assert.equal(F.internalSender(SOC, ["report@gershonconsulting.com"], ["ceo@valos.com"]), SOC);
assert.equal(F.internalSender(TP, ["lead@client.com"]), TP);
assert.equal(F.internalSender(SOC, []), SOC);

// Other senders (client workspace brand) never renamed.
assert.equal(F.internalSender("Social by Gershon.AI <reports@gershon.ai>", ["report@gershonconsulting.com"]), "Social by Gershon.AI <reports@gershon.ai>");
assert.equal(F.internalSender("GC Social <reports@gershon.ai>", ["report@gershonconsulting.com"]), "GC Social <reports@gershon.ai>");

// Look-alike domains are not internal.
assert.equal(F.isInternalAddress("x@gershonconsulting.com.evil.io"), false);
assert.equal(F.isInternalAddress("x@notgershon.ai"), false);

// withAuditBcc applies it; bcc audit copy does not make a client email internal.
const internal = M.withAuditBcc({ from: SOC, to: ["report@gershonconsulting.com"], subject: "s", html: "h" });
assert.equal(internal.from, "GC Social <reports@gershon.ai>");
const client = M.withAuditBcc({ from: SOC, to: ["client@wallix.com"], bcc: ["report@gershonconsulting.com"], subject: "s", html: "h" });
assert.equal(client.from, SOC);
console.log("internal-sender: all assertions passed");
