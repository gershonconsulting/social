export const runtime = "edge";

// Polyfill crypto.randomBytes for Cloudflare Workers edge runtime
// NextAuth v4 uses Node.js crypto.randomBytes for CSRF tokens
if (typeof globalThis.crypto !== "undefined") {
  const c = globalThis.crypto as any;
  if (!c.randomBytes) {
    c.randomBytes = (size: number): Buffer => {
      const bytes = new Uint8Array(size);
      crypto.getRandomValues(bytes);
      return Buffer.from(bytes);
    };
  }
}

import NextAuth from "next-auth";
import { authOptions } from "./options";

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
