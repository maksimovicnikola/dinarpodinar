import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@finance/domain", "jobs"],
};

export default nextConfig;
