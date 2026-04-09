/**
 * Next.js configuration for JobHound frontend.
 * Enables standalone output for Docker production builds.
 */

// import type { NextConfig } from "next";

// const nextConfig: NextConfig = {
//   output: "standalone",
//   images: {
//     remotePatterns: [
//       { protocol: "https", hostname: "lh3.googleusercontent.com" },
//     ],
//   },
// };

// export default nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },

  async rewrites() {
    return [
      {
        source: "/backend/:path*",
        destination: "http://backend:8000/:path*",
      },
    ];
  },
};

export default nextConfig;