import type { MetadataRoute } from "next";
import { issuer } from "@/lib/oauth/config";

/**
 * Crawlers get the public pages and nothing that needs a session or a
 * bearer token; those paths only answer with redirects and 401s anyway.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/privacy", "/terms", "/support"],
      disallow: [
        "/api/",
        "/oauth/",
        "/auth/",
        "/upcoming",
        "/inbox",
        "/activity",
        "/routines",
        "/settings",
        "/projects/",
      ],
    },
    sitemap: `${issuer()}/sitemap.xml`,
  };
}
