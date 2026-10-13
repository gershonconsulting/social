// Run from the repo root with a throwaway Postgres on :5433 (schema via prisma db push):
//   npx tsx tests/remote-collect.test.mts
import { PrismaClient } from "@prisma/client";
import * as RC from "../src/lib/remote-collect";
const R: any = (RC as any).requestCollection ? RC : (RC as any).default;
const db: any = new PrismaClient({ datasources: { db: { url: "postgresql://postgres@localhost:5433/social" } } });
let pass = 0, fail = 0;
const ok = (c: any, m: string) => { if (c) { pass++; console.log("  ✓", m); } else { fail++; console.log("  ✗", m); } };

await db.orgSetting.deleteMany({}); await db.client.deleteMany({}).catch(()=>{}); await db.organization.deleteMany({}).catch(()=>{});
const org = await db.organization.create({ data: { name: "Test", slug: "test-" + Date.now() } });
const other = await db.organization.create({ data: { name: "Other", slug: "other-" + Date.now() } });
const c1 = await db.client.create({ data: { name: "Cytel", slug: "cytel-" + Date.now(), organizationId: org.id } });
const cx = await db.client.create({ data: { name: "Foreign", slug: "foreign-" + Date.now(), organizationId: other.id } });

console.log("1. request + dedupe");
const j1 = await R.requestCollection(org.id, c1.id, db);
ok(j1.status === "queued" && j1.clientName === "Cytel", "queued one company with its name");
const j1b = await R.requestCollection(org.id, c1.id, db);
ok(j1b.id === j1.id, "same company again reuses the waiting job");
let threw = false; try { await R.requestCollection(org.id, cx.id, db); } catch { threw = true; }
ok(threw, "a company from another workspace is refused");

console.log("2. claim — concurrency: 10 browsers poll at once, 1 job");
const agents = Array.from({ length: 10 }, (_, i) => ({ id: "agent" + i, label: "Chrome (Windows)", version: "0.19.0" }));
const got = await Promise.all(agents.map((a) => R.claimNext(org.id, a, db)));
const winners = got.filter(Boolean);
ok(winners.length === 1 && winners[0].id === j1.id, "exactly one browser got the job (" + winners.length + ")");
let st = await R.queueStatus(org.id, db);
ok(st.agents.length === 10 && st.listening === 10, "all 10 browsers recorded as listening");
ok(st.jobs[0].status === "running", "job is running");
const winnerAgent = agents[got.findIndex(Boolean)].id;

console.log("3. nothing left to claim");
ok((await R.claimNext(org.id, agents[0], db)) === null, "next poll gets null");

console.log("4. result");
ok((await R.reportResult(org.id, j1.id, "intruder", { ok: true }, db)) === null, "a browser that did not claim it cannot report");
const done = await R.reportResult(org.id, j1.id, winnerAgent, { ok: true, upserted: 12, failed: 0, accounts: 2, errors: [] }, db);
ok(done && done.status === "done" && done.result.upserted === 12, "claimer reports → done, 12 posts");
ok((await R.reportResult(org.id, j1.id, winnerAgent, { ok: false }, db)) === null, "cannot report twice");

console.log("5. 'all companies' supersedes waiting single-company jobs");
const a = await R.requestCollection(org.id, c1.id, db);
const all = await R.requestCollection(org.id, null, db);
st = await R.queueStatus(org.id, db);
ok(st.jobs.find((j: any) => j.id === a.id).status === "expired" && all.status === "queued", "single job expired, all-companies queued");
const again = await R.requestCollection(org.id, c1.id, db);
ok(again.id === all.id, "a single-company request while 'all' waits reuses it");
const g = await R.claimNext(org.id, agents[3], db);
ok(g && g.id === all.id && g.clientId === null, "all-companies job claimed with clientId null");
const failed = await R.reportResult(org.id, all.id, "agent3", { ok: false, errors: ["LinkedIn signed out"] }, db);
ok(failed.status === "failed" && failed.error === "LinkedIn signed out", "failed result keeps the reason");

console.log("6. timeouts (pure)");
const s: any = { jobs: [
  { id: "r", clientId: null, clientName: null, requestedAt: new Date(0).toISOString(), status: "running", claimedAt: new Date(Date.now() - 46 * 60000).toISOString() },
  { id: "q", clientId: null, clientName: null, requestedAt: new Date(Date.now() - 25 * 3600000).toISOString(), status: "queued" },
], agents: {} };
R.expire(s, Date.now());
ok(s.jobs[0].status === "failed" && s.jobs[1].status === "expired", "stuck run → failed after 45 min; unclaimed → expired after 24 h");

console.log("7. polls are read-only when nothing changes");
const before = (await db.orgSetting.findFirst({ where: { organizationId: org.id, key: "collect_queue" } })).updatedAt;
await R.claimNext(org.id, agents[5], db);
const after = (await db.orgSetting.findFirst({ where: { organizationId: org.id, key: "collect_queue" } })).updatedAt;
ok(+before === +after, "an idle poll from a known browser writes nothing");

console.log("8. job list is capped");
for (let i = 0; i < 40; i++) { const j = await R.requestCollection(org.id, null, db); await R.claimNext(org.id, agents[1], db); await R.reportResult(org.id, j.id, "agent1", { ok: true }, db); }
st = await R.queueStatus(org.id, db);
ok(st.jobs.length === 30, "kept the last 30 jobs (" + st.jobs.length + ")");

console.log(`\n${pass} passed, ${fail} failed`);
await db.$disconnect();
process.exit(fail ? 1 : 0);
