export const runtime = "edge";

// Polyfill crypto.randomBytes for Cloudflare Workers edge runtime
// NextAuth v4 uses Node.js crypto.randomBytes for CSRF tokens
const _gc = globalThis as any;
if (typeof _gc.crypto !== "undefined" && !_gc.crypto.randomBytes) {
  _gc.crypto.randomBytes = (size: number): Uint8Array => {
    const bytes = new Uint8Array(size);
    crypto.getRandomValues(bytes);
    return bytes as any;
  };
}

import NextAuth from "next-auth";
import { authOptions } from "./options";

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
