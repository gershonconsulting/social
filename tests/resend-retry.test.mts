// Run: npx tsx --test tests/resend-retry.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import * as m from "../src/lib/resend-send.ts";
const { sendResend, RESEND_RETRY_DELAYS_MS } = ((m as any).default ?? m) as typeof m;

type Step = number | "network";
function mockFetch(steps: Step[]) {
  const calls: { key: string | undefined; body: string }[] = [];
  const impl = (async (_url: string, init: RequestInit) => {
    calls.push({ key: (init.headers as Record<string, string>)["Idempotency-Key"], body: String(init.body) });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step === "network") throw new TypeError("fetch failed");
    const json = step < 300 ? { id: "email_123" } : { name: step === 429 ? "rate_limit_exceeded" : "validation_error", message: `status ${step}` };
    return new Response(JSON.stringify(json), { status: step });
  }) as unknown as typeof fetch;
  return { calls, impl };
}
function silent<T>(fn: () => Promise<T>): Promise<T> {
  const { warn, error } = console;
  console.warn = () => {};
  console.error = () => {};
  return fn().finally(() => { console.warn = warn; console.error = error; });
}
const payload = { from: "GC Social <reports@gershon.ai>", to: ["test@example.com"], subject: "Social daily report", html: "<p>x</p>" };

test("429 then 200 = one logical send with the same Idempotency-Key", async () => {
  const f = mockFetch([429, 200]);
  const waits: number[] = [];
  const r = await silent(() => sendResend("k", payload, { fetchImpl: f.impl, sleep: async (ms) => { waits.push(ms); } }));
  assert.equal(r.ok, true);
  assert.equal(r.id, "email_123");
  assert.equal(r.attempts, 2);
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls[0].key, "Idempotency-Key header set");
  assert.equal(f.calls[1].key, f.calls[0].key);
  assert.equal(f.calls[1].body, f.calls[0].body);
  assert.deepEqual(waits, [1000]);
});

test("400 is not retried", async () => {
  const f = mockFetch([400, 200]);
  const r = await silent(() => sendResend("k", payload, { fetchImpl: f.impl, sleep: async () => {} }));
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.equal(f.calls.length, 1);
});

test("caller key (Friday once-per-day) is kept across network error and 503", async () => {
  const f = mockFetch(["network", 503, 200]);
  const r = await silent(() => sendResend("k", payload, { fetchImpl: f.impl, sleep: async () => {}, idempotencyKey: "social-client-c1-company-2026-11-13" }));
  assert.equal(r.ok, true);
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls.every((c) => c.key === "social-client-c1-company-2026-11-13"));
});

test("persistent 500: 3 retries (1s, 4s, 10s) then a logged final failure", async () => {
  const f = mockFetch([500]);
  const waits: number[] = [];
  let logged = "";
  const { warn, error } = console;
  console.warn = () => {};
  console.error = (s: string) => { logged = s; };
  try {
    const r = await sendResend("k", payload, { fetchImpl: f.impl, sleep: async (ms) => { waits.push(ms); }, label: "friday-company" });
    assert.equal(r.ok, false);
    assert.equal(f.calls.length, 4);
    assert.deepEqual(waits, RESEND_RETRY_DELAYS_MS);
    assert.match(logged, /friday-company: FINAL FAILURE after 4 attempt/);
  } finally { console.warn = warn; console.error = error; }
});

test("409 for an already-used key is not retried (Friday once.ts reads it as already sent)", async () => {
  const f = mockFetch([409, 200]);
  const r = await silent(() => sendResend("k", payload, { fetchImpl: f.impl, sleep: async () => {}, idempotencyKey: "social-client-c1-company-2026-11-13" }));
  assert.equal(r.status, 409);
  assert.equal(f.calls.length, 1);
});
