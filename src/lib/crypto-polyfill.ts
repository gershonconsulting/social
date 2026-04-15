/**
 * Polyfill Node.js crypto.randomBytes for Cloudflare Workers edge runtime.
 * NextAuth v4 uses randomBytes for CSRF tokens; the edge runtime only has
 * Web Crypto API (crypto.getRandomValues), not Node's crypto.randomBytes.
 */

const _g = globalThis as any;

if (typeof _g.crypto !== "undefined" && !_g.crypto.randomBytes) {
  _g.crypto.randomBytes = (size: number): Uint8Array => {
    const bytes = new Uint8Array(size);
    crypto.getRandomValues(bytes);
    return bytes as any;
  };
}

export {};
