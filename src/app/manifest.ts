import type { MetadataRoute } from "next";

/**
 * Web app manifest, so the app installs to a home screen or dock and opens
 * without browser chrome. The icon files live in `public/`; the favicon and
 * Apple icon are the `app/icon.svg` and `app/apple-icon.png` conventions.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "agenticTODO",
    short_name: "agenticTODO",
    description:
      "A free todo list with no AI inside. Your coding agent is the AI.",
    start_url: "/upcoming",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    categories: ["productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
