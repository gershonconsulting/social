/**
 * Stub for `openid-client` used by next-auth's OAuth flow.
 * We only use CredentialsProvider + JWT, so the OAuth code paths never execute.
 * This stub prevents next-auth from bundling the real openid-client module which
 * uses [util.inspect.custom]() computed class methods that fail in the edge runtime.
 */
"use strict";

const customSymbol =
  typeof Symbol.for === "function"
    ? Symbol.for("nodejs.util.inspect.custom")
    : Symbol("nodejs.util.inspect.custom");

class TokenSet {
  constructor(params) {
    Object.assign(this, params || {});
  }
  get id_token() { return this.id_token || null; }
  expired() { return false; }
  claims() { return {}; }
  [customSymbol]() { return "TokenSet {}"; }
}

const generators = {
  random: (bytes) => Math.random().toString(36).slice(2),
  state: () => Math.random().toString(36).slice(2),
  nonce: () => Math.random().toString(36).slice(2),
  codeVerifier: () => Math.random().toString(36).slice(2),
  codeChallenge: async (verifier) => verifier,
};

const custom = {
  http_options: Symbol("http_options"),
  clock_skew: Symbol("clock_skew"),
  clock_tolerance: Symbol("clock_tolerance"),
};

class Issuer {
  constructor(metadata) {
    Object.assign(this, metadata || {});
  }
  static discover() {
    return Promise.reject(new Error("openid-client stub: Issuer.discover not supported"));
  }
  static async webfinger() {
    throw new Error("openid-client stub: Issuer.webfinger not supported");
  }
  Client() {}
  get metadata() { return {}; }
  [customSymbol]() { return "Issuer {}"; }
}

Issuer.prototype.Client = class OIDCClient {
  constructor() {}
  async authorizationUrl() { throw new Error("openid-client stub: OAuth not supported"); }
  async callback() { throw new Error("openid-client stub: OAuth not supported"); }
  async userinfo() { throw new Error("openid-client stub: OAuth not supported"); }
  async refresh() { throw new Error("openid-client stub: OAuth not supported"); }
  [customSymbol]() { return "Client {}"; }
};

module.exports = {
  Issuer,
  TokenSet,
  generators,
  custom,
};
