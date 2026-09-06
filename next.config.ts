import type { NextConfig } from 'next';

const nextConfig: NextConfig =
  process.env.SPOOLSTAMP_BUILD_TARGET === 'static'
    ? { output: 'export', images: { unoptimized: true } }
    : {};

export default nextConfig;
