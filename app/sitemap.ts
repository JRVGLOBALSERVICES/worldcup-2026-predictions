import type { MetadataRoute } from "next";
import { fixtures, predictionFile } from "@/lib/data";

const SITE = "https://worldcup-2026-orpin-zeta.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date(predictionFile.meta.generatedAt);
  return [
    { url: SITE, lastModified, changeFrequency: "daily", priority: 1 },
    { url: `${SITE}/standings`, lastModified, changeFrequency: "daily", priority: 0.8 },
    { url: `${SITE}/stats`, lastModified, changeFrequency: "daily", priority: 0.8 },
    ...fixtures.map((f) => ({
      url: `${SITE}/match/${f.id}`,
      lastModified,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
  ];
}
