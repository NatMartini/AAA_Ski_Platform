import type { MetadataRoute } from "next";

/**
 * Blanket disallow. This is a private booking tool shared as a link in a group
 * chat — there is no page here that should ever appear in a search result.
 * Paired with the X-Robots-Tag header in next.config.ts, since robots.txt is
 * advisory and the header is the one that stops indexing of a page someone
 * links to directly.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
