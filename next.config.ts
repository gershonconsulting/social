import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  webpack: (config) => {
    // Stub out Node.js built-ins that next-auth's oauth dependency may require.
    // We only use CredentialsProvider + JWT, so OAuth code paths never run.
    config.resolve.fallback = {
      ...config.resolve.fallback,
      http: false,
      https: false,
      querystring: false,
      url: false,
      net: false,
      tls: false,
      fs: false,
    };

    // Point crypto to our shim that provides randomBytes via Web Crypto API.
    // NextAuth v4 requires crypto.randomBytes for CSRF tokens.
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      crypto: path.resolve("./src/lib/crypto-shim.js"),
      "openid-client": path.resolve("./src/lib/openid-client-stub.js"),
    };

    return config;
  },
};

export default nextConfig;
