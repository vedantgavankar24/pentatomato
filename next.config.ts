import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  turbopack: {},  // Important addition to silence the error

  webpack: (config) => {
    if (config.resolve?.alias) {
      config.resolve.alias['canvas'] = false;
    }
    return config;
  },
};

export default nextConfig;
