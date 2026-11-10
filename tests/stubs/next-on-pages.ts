// Test stub: no Cloudflare request context outside the worker.
export function getRequestContext(): never {
  throw new Error("no request context in tests");
}
