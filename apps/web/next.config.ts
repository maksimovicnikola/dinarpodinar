import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@finance/domain"],
};

export default nextConfig;
