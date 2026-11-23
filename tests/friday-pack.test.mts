// v4.81.0 one Friday e-mail per client — no DB:  npx tsx --tsconfig tests/tsconfig.test.json tests/friday-pack.test.mts
const m = <T,>(x: T): T => ((x as { default?: T }).default ?? x);
const { combineFridayHtml, fridayPackSubject } = m(await import("../src/lib/reports/friday/pack"));

let pass = 0, fail = 0;
const ok = (c: unknown, msg: string) => { if (c) { pass++; console.log("  ✓", msg); } else { fail++; console.log("  ✗", msg); } };

const doc = (t: string) => `<!doctype html><html><head><title>${t}</title></head>\n<body style="margin:0;">\n<div>${t} body</div></body></html>`;
const subject = fridayPackSubject({ client: { name: "VALOS" }, weekLabel: "Nov 13 – Nov 19" });
ok(subject === "Social.gershon.ai — VALOS — Client report (week of Nov 13 – Nov 19)", "one subject per client");
const one = combineFridayHtml("A & B", [doc("Company"), doc("Competitive"), doc("Intelligence")]);
ok((one.match(/<body/g) || []).length === 1 && (one.match(/<\/html>/g) || []).length === 1, "the three reports are ONE e-mail document");
ok(one.indexOf("Company body") < one.indexOf("Competitive body") && one.indexOf("Competitive body") < one.indexOf("Intelligence body"), "order Company → Competitive → Intelligence");
ok(one.includes("<title>A &amp; B</title>"), "subject escaped in the title");
ok(combineFridayHtml("s", ["<p>no body tag</p>"]).includes("<p>no body tag</p>"), "a fragment without <body> is kept as is");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
