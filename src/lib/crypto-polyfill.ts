/**
 * Polyfill Node.js crypto.randomBytes for Cloudflare Workers edge runtime.
 * NextAuth v4 uses randomBytes for CSRF tokens; the edge runtime only has
 * Web Crypto API (crypto.getRandomValues), not Node's crypto.randomBytes.
 */

if (typeof globalThis.crypto !== "undefined" && !globalThis.crypto.randomBytes) {
  (globalThis.crypto as any).randomBytes = (size: number): Buffer => {
    const bytes = new Uint8Array(size);
    crypto.getRandomValues(bytes);
    return Buffer.from(bytes);
  };
}

// Also patch if accessed via require('crypto')
if (typeof globalThis.process !== "undefined") {
  try {
    const cryptoModule = require("crypto");
    if (!cryptoModule.randomBytes) {
      cryptoModule.randomBytes = (size: number): Buffer => {
        const bytes = new Uint8Array(size);
        crypto.getRandomValues(bytes);
        return Buffer.from(bytes);
      };
    }
  } catch {
    // ignore if require not available
  }
}

export {};
