// Shim for Node.js crypto module on Cloudflare Workers edge runtime.
// NextAuth v4 calls require("crypto").randomBytes() for CSRF tokens.
// With crypto: false in webpack, that import gets an empty module.
// This shim bridges to the Web Crypto API available on Workers.

"use strict";

exports.randomBytes = function randomBytes(size) {
  var bytes = new Uint8Array(size);
  globalThis.crypto.getRandomValues(bytes);
  // Return a Buffer-like object (Uint8Array works for NextAuth's use case)
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes);
  }
  return bytes;
};

exports.createHash = function createHash(algorithm) {
  // Minimal stub - NextAuth JWT strategy does not call createHash at runtime
  // but the import may be evaluated
  throw new Error("createHash is not available in edge runtime - use Web Crypto API");
};
