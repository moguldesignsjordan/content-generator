import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Generating a full piece with Claude can take 30–90s; routes that call the
  // model set their own `maxDuration` (see app/api/*). Nothing global needed yet.
};

export default nextConfig;
