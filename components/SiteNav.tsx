import Link from "next/link";

export type NavKey = "predictions" | "stats" | "rj" | "ruhan";

const ITEMS: { key: NavKey; href: string; label: string }[] = [
  { key: "predictions", href: "/", label: "Predictions" },
  { key: "stats", href: "/stats", label: "Stats" },
  { key: "rj", href: "/tracker", label: "Rj's Tracker" },
  { key: "ruhan", href: "/tracker/ruhan", label: "Ruhan's Tracker" },
];

/** Shared site nav — Predictions + both bet trackers, active one in acid.
 *  Mobile: full-width evenly-spaced row. Desktop: compact top-right cluster. */
export function SiteNav({ active }: { active: NavKey }) {
  return (
    <nav className="flex w-full items-center justify-between gap-2 font-mono text-[0.66rem] uppercase tracking-[0.12em] sm:w-auto sm:justify-end sm:gap-x-4 sm:gap-y-1 sm:tracking-[0.18em]">
      {ITEMS.map((it) =>
        it.key === active ? (
          <span key={it.key} className="whitespace-nowrap text-acid">
            {it.label}
          </span>
        ) : (
          <Link
            key={it.key}
            href={it.href}
            className="whitespace-nowrap text-faint transition-colors hover:text-ink"
          >
            {it.label}
          </Link>
        ),
      )}
    </nav>
  );
}
