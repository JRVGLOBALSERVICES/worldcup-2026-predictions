import type { Metadata } from "next";
import { Geist, Geist_Mono, Archivo } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
});

const SITE = "https://worldcup-2026-orpin-zeta.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "Matchday Edge — World Cup 2026 Predictions",
    template: "%s · Matchday Edge",
  },
  description:
    "Daily World Cup 2026 predictions in Malaysia time: win, half-time & full-time scores, scorers, assists and penalty takers — built from live team-news research on every fixture.",
  keywords: [
    "World Cup 2026 predictions",
    "match predictions Malaysia time",
    "anytime scorer tips",
    "half-time full-time predictions",
    "penalty taker predictions",
  ],
  openGraph: {
    title: "Matchday Edge — World Cup 2026 Predictions",
    description:
      "Win, HT/FT scores, scorers, assists and penalty takers for every World Cup 2026 fixture — in Malaysia time, refreshed daily.",
    type: "website",
    url: SITE,
  },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${archivo.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
