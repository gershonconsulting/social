/**
 * Keep a slow request alive (v4.56.0).
 *
 * Cloudflare closes a request with error 524 when the server sends nothing for
 * ~100 seconds. The AI features (Content Intelligence "Analyze content", Post
 * Studio "Generate prompt") can take longer than that on Workers AI, so they
 * failed with a 524 page instead of a result.
 *
 * keepAlive() answers at once with 200 and streams a space every few seconds
 * while the work runs, then the real JSON. Leading spaces are valid JSON, so
 * the page's `await r.json()` reads it as before. The real HTTP status (409,
 * 428, 500…) can no longer be sent, so it is added to the body as `status`;
 * every error body already carries `success: false`, which the pages check.
 */
export function keepAlive(work: () => Promise<Response>, everyMs = 5000): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Not awaited: start() must return at once so the 200 + first byte leave now.
      void run(controller);
    },
  });
  async function run(controller: ReadableStreamDefaultController<Uint8Array>) {
      controller.enqueue(enc.encode(" "));
      const tick = setInterval(() => {
        try { controller.enqueue(enc.encode(" ")); } catch { /* closed */ }
      }, everyMs);
      let body: string;
      try {
        const res = await work();
        const text = await res.text();
        if (res.ok) body = text;
        else {
          try {
            const j = JSON.parse(text) as Record<string, unknown>;
            body = JSON.stringify({ ...j, success: false, status: res.status });
          } catch {
            body = JSON.stringify({ success: false, status: res.status, error: text.slice(0, 300) || `HTTP ${res.status}` });
          }
        }
      } catch (e) {
        body = JSON.stringify({ success: false, error: e instanceof Error ? e.message : "Failed" });
      }
      clearInterval(tick);
      controller.enqueue(enc.encode(body));
      controller.close();
  }
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
