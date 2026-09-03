/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next.js sends X-Powered-By: Next.js on every response by default,
  // advertising the exact framework to anyone probing — same reasoning as
  // the Helmet headers added on the API side.
  poweredByHeader: false,
};

module.exports = nextConfig;
