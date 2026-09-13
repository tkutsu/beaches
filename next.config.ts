import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No server to speak of: the map is client-rendered and its data is baked
  // into public/data by scripts/sync-beaches.mjs at build time.
  output: "export",
  // Keeps the page URL a directory, so the relative fetches for the
  // catalogue resolve cleanly.
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
