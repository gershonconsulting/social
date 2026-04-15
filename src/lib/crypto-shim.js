"use strict";

// ---- randomBytes via Web Crypto API ----
exports.randomBytes = function randomBytes(size) {
  var bytes = new Uint8Array(size);
  globalThis.crypto.getRandomValues(bytes);
  if (typeof Buffer !== "undefined") return Buffer.from(bytes);
  return bytes;
};

// ---- Minimal sync SHA-256 (pure JS) for NextAuth CSRF tokens ----
// Based on the FIPS 180-4 spec. Only SHA-256 is implemented because
// that is the only algorithm NextAuth v4 uses at runtime with
// CredentialsProvider + JWT strategy.

function sha256(message) {
  var H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ];
  var K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ];

  // Convert string to bytes
  var bytes;
  if (typeof message === "string") {
    bytes = [];
    for (var i = 0; i < message.length; i++) {
      var c = message.charCodeAt(i);
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) { bytes.push(0xc0 | (c >> 6)); bytes.push(0x80 | (c & 0x3f)); }
      else { bytes.push(0xe0 | (c >> 12)); bytes.push(0x80 | ((c >> 6) & 0x3f)); bytes.push(0x80 | (c & 0x3f)); }
    }
  } else if (bytes instanceof Uint8Array || Array.isArray(message)) {
    bytes = Array.from(message);
  } else if (typeof Buffer !== "undefined" && Buffer.isBuffer(message)) {
    bytes = Array.from(message);
  } else {
    bytes = Array.from(new Uint8Array(message));
  }

  // Padding
  var len = bytes.length;
  bytes.push(0x80);
  while ((bytes.length % 64) !== 56) bytes.push(0);
  var bitLen = len * 8;
  for (var s = 56; s >= 0; s -= 8) bytes.push((bitLen / Math.pow(2, s)) & 0xff);

  // Process blocks
  for (var offset = 0; offset < bytes.length; offset += 64) {
    var W = new Array(64);
    for (var t = 0; t < 16; t++) {
      W[t] = (bytes[offset + t*4] << 24) | (bytes[offset + t*4+1] << 16) |
             (bytes[offset + t*4+2] << 8) | bytes[offset + t*4+3];
    }
    for (var t = 16; t < 64; t++) {
      var s0 = (ror(W[t-15],7)) ^ (ror(W[t-15],18)) ^ (W[t-15] >>> 3);
      var s1 = (ror(W[t-2],17)) ^ (ror(W[t-2],19)) ^ (W[t-2] >>> 10);
      W[t] = (W[t-16] + s0 + W[t-7] + s1) | 0;
    }
    var a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
    for (var t = 0; t < 64; t++) {
      var S1 = (ror(e,6)) ^ (ror(e,11)) ^ (ror(e,25));
      var ch = (e & f) ^ ((~e) & g);
      var temp1 = (h + S1 + ch + K[t] + W[t]) | 0;
      var S0 = (ror(a,2)) ^ (ror(a,13)) ^ (ror(a,22));
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var temp2 = (S0 + maj) | 0;
      h=g; g=f; f=e; e=(d+temp1)|0; d=c; c=b; b=a; a=(temp1+temp2)|0;
    }
    H[0]=(H[0]+a)|0; H[1]=(H[1]+b)|0; H[2]=(H[2]+c)|0; H[3]=(H[3]+d)|0;
    H[4]=(H[4]+e)|0; H[5]=(H[5]+f)|0; H[6]=(H[6]+g)|0; H[7]=(H[7]+h)|0;
  }

  // Output as hex
  var hex = "";
  for (var i = 0; i < 8; i++) {
    for (var s = 28; s >= 0; s -= 4) hex += ((H[i] >>> s) & 0xf).toString(16);
  }
  return hex;
}

function ror(n, b) { return ((n >>> b) | (n << (32 - b))) >>> 0; }

exports.createHash = function createHash(algorithm) {
  if (algorithm !== "sha256" && algorithm !== "SHA-256" && algorithm !== "SHA256") {
    throw new Error("crypto-shim: only sha256 is supported, got " + algorithm);
  }
  var _data = "";
  return {
    update: function update(data) {
      if (typeof data === "string") _data += data;
      else _data = data;
      return this;
    },
    digest: function digest(encoding) {
      var hex = sha256(_data);
      if (encoding === "hex") return hex;
      // Return as buffer for other encodings
      var bytes = [];
      for (var i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.substr(i, 2), 16));
      if (typeof Buffer !== "undefined") return Buffer.from(bytes);
      return new Uint8Array(bytes);
    }
  };
};
