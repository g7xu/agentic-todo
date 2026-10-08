import type { MetadataRoute } from "next";
import { issuer } from "@/lib/oauth/config";
import { LEGAL_UPDATED } from "@/lib/legal";

/** The four pages a signed-out visitor can read. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = issuer();
  const legalChanged = new Date(LEGAL_UPDATED);
  return [
    { url: `${base}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${base}/support`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/privacy`, lastModified: legalChanged, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/terms`, lastModified: legalChanged, changeFrequency: "yearly", priority: 0.3 },
  ];
}
