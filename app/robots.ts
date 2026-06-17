import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: "https://worldcup-2026-predictions.vercel.app/sitemap.xml",
  };
}
