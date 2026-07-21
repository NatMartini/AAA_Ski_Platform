import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Content-Security-Policy. 'unsafe-inline' for script/style is what Next's
// inline hydration script and Tailwind need; tightening to nonces is a bigger
// job than it is worth here. What it does buy us: no third-party scripts, no
// third-party form posts, no framing, no plugins.
const CSP = [
  "default-src 'self'",
  process.env.NODE_ENV === "production"
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  // blob: is needed for the signature canvas -> PNG preview.
  "img-src 'self' data: blob: https://lh3.googleusercontent.com",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self' https://accounts.google.com",
  "frame-ancestors 'none'",
  "form-action 'self' https://accounts.google.com",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  serverExternalPackages: ["sharp", "nodemailer"],

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          // This site is private: handed out as a link in a WeChat group, never
          // indexed. Paired with a blanket-disallow robots.txt.
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
