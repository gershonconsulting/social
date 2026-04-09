import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  webpack: (config) => {
    // Stub out Node.js built-ins that next-auth's oauth dependency may require.
    // We only use CredentialsProvider + JWT, so OAuth code paths never run.
    config.resolve.fallback = {
      ...config.resolve.fallback,
      crypto: false,
      http: false,
      https: false,
      querystring: false,
      url: false,
      net: false,
      tls: false,
      fs: false,
    };

    // Replace openid-client with a stub. We only use CredentialsProvider + JWT,
    // so the OAuth code paths that use openid-client never execute. The real
    // openid-client uses [util.inspect.custom]() computed class methods which
    // throw at class-definition time in the Next.js edge runtime simulation.
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "openid-client": path.resolve("./src/lib/openid-client-stub.js"),
    };

    return config;
  },
};

export default nextConfig;
