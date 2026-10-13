// Run from the repo root with a throwaway Postgres on :5433 (schema via prisma db push).
// Loads the REAL extension-src/gx-remote.js in a fake Chrome against a server built from
// src/lib/remote-collect.ts:  npx tsx tests/remote-collect-e2e.test.mts
import http from "node:http";
import fs from "node:fs";
import vm from "node:vm";
import { PrismaClient } from "@prisma/client";
import * as RCm from "../src/lib/remote-collect";
const RC: any = (RCm as any).requestCollection ? RCm : (RCm as any).default;
const db: any = new PrismaClient({ datasources: { db: { url: "postgresql://postgres@localhost:5433/social" } } });
let pass = 0, fail = 0;
const ok = (c: any, m: string) => { if (c) { pass++; console.log("  ✓", m); } else { fail++; console.log("  ✗", m); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── workspace + token ──
await db.orgSetting.deleteMany({}); await db.client.deleteMany({}); await db.organization.deleteMany({});
const org = await db.organization.create({ data: { name: "Gershon", slug: "g" } });
const cyt = await db.client.create({ data: { name: "Cytel", slug: "cytel", organizationId: org.id } });
await db.orgSetting.create({ data: { organizationId: org.id, key: "extension_token", value: "wt_test" } });

// ── server: same logic as the 4 routes ──
const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url!, "http://x");
  const send = (code: number, body: any) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  const tok = (req.headers["x-gershon-token"] || "") as string;
  const row = tok ? await db.orgSetting.findFirst({ where: { key: "extension_token", value: tok } }) : null;
  if (u.pathname.startsWith("/api/extension/collect/")) {
    if (!row) return send(401, { success: false });
    if (u.pathname.endsWith("/next")) {
      const job = await RC.claimNext(row.organizationId, { id: u.searchParams.get("agent"), version: u.searchParams.get("v"), label: u.searchParams.get("label") }, db);
      return send(200, { success: true, data: { job: job ? { id: job.id, clientId: job.clientId } : null } });
    }
    if (u.pathname.endsWith("/result")) {
      let b = ""; for await (const c of req) b += c; const j = JSON.parse(b);
      const r = await RC.reportResult(row.organizationId, j.id, j.agent, { ok: j.ok, upserted: j.totalUpserted, failed: j.totalFailed, accounts: j.accountCount, errors: j.errors }, db);
      return send(r ? 200 : 404, { success: !!r });
    }
  }
  send(404, {});
});
await new Promise<void>((r) => srv.listen(0, r));
const port = (srv.address() as any).port;

// ── fake Chrome + load the real extension file ──
function makeChrome(store: Record<string, any>) {
  const alarms: Record<string, any> = {}; const alarmL: any[] = [];
  return {
    alarms: {
      get: (n: string, cb?: any) => { const a = alarms[n] || null; if (cb) cb(a); return Promise.resolve(a); },
      create: (n: string, o: any) => { alarms[n] = o; },
      onAlarm: { addListener: (f: any) => alarmL.push(f) },
      _fire: async (n: string) => { for (const f of alarmL) await f({ name: n }); },
      _all: alarms,
    },
    storage: { local: {
      get: (k: string) => Promise.resolve({ [k]: store[k] }),
      set: (o: any) => { Object.assign(store, o); return Promise.resolve(); },
    } },
    runtime: { getManifest: () => ({ version: "0.19.0" }), getPlatformInfo: () => Promise.resolve({ os: "win" }),
      onInstalled: { addListener() {} }, onStartup: { addListener() {} } },
    action: { setBadgeText() {} },
  };
}
function loadExtension(store: Record<string, any>, runFullSync: any) {
  const chrome = makeChrome(store);
  const self: any = { runFullSync };
  const fetchShim = (url: string, init: any = {}) => {
    const u = url.replace("https://social.gershon.ai", `http://localhost:${port}`);
    const headers = { ...(init.headers || {}), "x-gershon-token": store.workspaceToken || "" };  // what gx-token.js adds
    return fetch(u, { ...init, headers });
  };
  vm.runInNewContext(fs.readFileSync("extension-src/gx-remote.js", "utf8"), { chrome, self, fetch: fetchShim, crypto, setTimeout, console, encodeURIComponent, JSON, String, Math, Date, Promise });
  return { chrome, self };
}

console.log("1. alarm set up at load");
const calls: any[] = [];
const A = loadExtension({ workspaceToken: "wt_test" }, async (o: any) => { calls.push(o); await sleep(200); return { ok: true, totalUpserted: 7, totalFailed: 0, accountCount: 2, ingestErrors: [], badPlatforms: [] }; });
ok(A.chrome.alarms._all["remote-collect-tick"]?.periodInMinutes === 1, "checks every minute");

console.log("2. idle tick → registers the browser, runs nothing");
await A.chrome.alarms._fire("remote-collect-tick");
let st = await RC.queueStatus(org.id, db);
ok(st.agents.length === 1 && st.agents[0].version === "0.19.0" && st.agents[0].label === "Chrome on Windows", "browser listed: Chrome on Windows v0.19.0");
ok(calls.length === 0, "no collection without a request");

console.log("3. dashboard asks for Cytel → next tick collects it in the background");
const job = await RC.requestCollection(org.id, cyt.id, db);
await A.chrome.alarms._fire("remote-collect-tick");
ok(calls.length === 1 && calls[0].clientIdFilter === cyt.id && calls[0].trigger === "remote", "ran runFullSync for Cytel only");
st = await RC.queueStatus(org.id, db);
const j = st.jobs.find((x: any) => x.id === job.id);
ok(j.status === "done" && j.result.upserted === 7 && j.result.accounts === 2, "server shows done: 7 posts, 2 accounts");

console.log("4. two browsers, one 'every company' request → exactly one runs it");
const calls2: any[] = [];
const B = loadExtension({ workspaceToken: "wt_test" }, async (o: any) => { calls2.push(o); return { ok: true, totalUpserted: 1 }; });
const all = await RC.requestCollection(org.id, null, db);
await Promise.all([A.chrome.alarms._fire("remote-collect-tick"), B.chrome.alarms._fire("remote-collect-tick")]);
ok(calls.length + calls2.length === 2 && [...calls, ...calls2].filter((c) => c.clientIdFilter === undefined).length === 1, "one browser ran it, unfiltered (all companies)");
st = await RC.queueStatus(org.id, db);
ok(st.agents.length === 2 && st.listening === 2, "both browsers listed");

console.log("5. a failing run is reported with its reason");
const C = loadExtension({ workspaceToken: "wt_test" }, async () => ({ ok: false, ingestErrors: ["LinkedIn signed out"], badPlatforms: [] }));
const fj = await RC.requestCollection(org.id, cyt.id, db);
await C.chrome.alarms._fire("remote-collect-tick");
st = await RC.queueStatus(org.id, db);
ok(st.jobs.find((x: any) => x.id === fj.id).status === "failed" && st.jobs.find((x: any) => x.id === fj.id).error === "LinkedIn signed out", "failed: LinkedIn signed out");

console.log("6. a crash inside the run is reported too");
const D = loadExtension({ workspaceToken: "wt_test" }, async () => { throw new Error("tab crashed"); });
const cj = await RC.requestCollection(org.id, cyt.id, db);
await D.chrome.alarms._fire("remote-collect-tick");
st = await RC.queueStatus(org.id, db);
ok(st.jobs.find((x: any) => x.id === cj.id).error === "tab crashed", "failed: tab crashed");

console.log("7. not bound / client publishing key → never asks");
const n1: any[] = []; const E = loadExtension({}, async (o: any) => { n1.push(o); return { ok: true }; });
const F = loadExtension({ workspaceToken: "gp_client" }, async (o: any) => { n1.push(o); return { ok: true }; });
await RC.requestCollection(org.id, cyt.id, db);
const agentsBefore = (await RC.queueStatus(org.id, db)).agents.length;
await E.chrome.alarms._fire("remote-collect-tick"); await F.chrome.alarms._fire("remote-collect-tick");
ok(n1.length === 0 && (await RC.queueStatus(org.id, db)).agents.length === agentsBefore, "unbound and gp_ installs stay silent");

console.log("8. busy with the daily collection → waits");
const G = loadExtension({ workspaceToken: "wt_test" }, async () => ({ ok: true }));
G.self.gxCollectRunning = () => true;
await G.chrome.alarms._fire("remote-collect-tick");
ok((await RC.queueStatus(org.id, db)).jobs[0].status === "queued", "job left waiting while a run is in progress");
G.self.gxCollectRunning = () => false;
await G.chrome.alarms._fire("remote-collect-tick");
ok((await RC.queueStatus(org.id, db)).jobs[0].status === "done", "picked up on the next minute");

console.log("9. wrong token → refused by the server, nothing runs");
const n2: any[] = []; const H = loadExtension({ workspaceToken: "wt_wrong" }, async (o: any) => { n2.push(o); return { ok: true }; });
await RC.requestCollection(org.id, cyt.id, db);
await H.chrome.alarms._fire("remote-collect-tick");
ok(n2.length === 0 && (await RC.queueStatus(org.id, db)).jobs[0].status === "queued", "unknown token gets nothing");

console.log(`\n${pass} passed, ${fail} failed`);
srv.close(); await db.$disconnect(); process.exit(fail ? 1 : 0);
