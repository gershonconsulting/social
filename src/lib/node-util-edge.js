/**
 * Minimal `node:util` stub for the Cloudflare edge runtime build.
 * Provides inspect.custom so that openid-client (bundled by next-auth)
 * can define its class methods without throwing at class-definition time.
 */
"use strict";

const customSymbol =
  typeof Symbol.for === "function"
    ? Symbol.for("nodejs.util.inspect.custom")
    : Symbol("nodejs.util.inspect.custom");

function inspect(obj) {
  return String(obj);
}
inspect.custom = customSymbol;
inspect.colors = {};
inspect.styles = {};
inspect.defaultOptions = {};

function format(...args) {
  return args.map(String).join(" ");
}

function inherits(ctor, superCtor) {
  Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
}

function promisify(fn) {
  return function (...args) {
    return new Promise((resolve, reject) => {
      fn(...args, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
  };
}

const TextDecoder = globalThis.TextDecoder;
const TextEncoder = globalThis.TextEncoder;

module.exports = {
  inspect,
  format,
  inherits,
  promisify,
  TextDecoder,
  TextEncoder,
  types: {
    isUint8Array: (v) => v instanceof Uint8Array,
    isNativeError: (v) => v instanceof Error,
  },
};
