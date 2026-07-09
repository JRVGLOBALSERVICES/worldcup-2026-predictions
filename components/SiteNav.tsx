import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";

export type NavKey = "predictions" | "stats" | "rj" | "ruhan" | "tharma";

const ITEMS: { key: NavKey; href: string; label: string }[] = [
  { key: "predictions", href: "/", label: "Predictions" },
  { key: "stats", href: "/stats", label: "Stats" },
  { key: "rj", href: "/tracker", label: "Rj's Tracker" },
  { key: "ruhan", href: "/tracker/ruhan", label: "Ruhan's Tracker" },
  { key: "tharma", href: "/tracker/tharma", label: "Tharma's Tracker" },
];

/** Shared site nav — Predictions + both bet trackers, active one in acid.
 *  Mobile: full-width evenly-spaced row. Desktop: compact top-right cluster. */
export function SiteNav({ active }: { active: NavKey }) {
  return (
    <nav className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1.5 font-mono text-[0.7rem] uppercase tracking-[0.1em] sm:w-auto sm:flex-nowrap sm:justify-end sm:gap-x-4 sm:gap-y-1 sm:tracking-[0.18em]">
      {ITEMS.map((it) =>
        it.key === active ? (
          <span key={it.key} data-on="true" className="chan whitespace-nowrap font-semibold text-acid">
            {it.label}
          </span>
        ) : (
          <Link
            key={it.key}
            href={it.href}
            data-on="false"
            className="chan whitespace-nowrap text-faint transition-colors hover:text-ink"
          >
            {it.label}
          </Link>
        ),
      )}
      <ThemeToggle />
    </nav>
  );
}
