import Link from "next/link";

export type NavKey = "predictions" | "rj" | "ruhan";

const ITEMS: { key: NavKey; href: string; label: string }[] = [
  { key: "predictions", href: "/", label: "Predictions" },
  { key: "rj", href: "/tracker", label: "Rj's Tracker" },
  { key: "ruhan", href: "/tracker/ruhan", label: "Ruhan's Tracker" },
];

/** Shared top-right site nav — Predictions + both bet trackers, active one in acid. */
export function SiteNav({ active }: { active: NavKey }) {
  return (
    <nav className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 font-mono text-[0.66rem] uppercase tracking-[0.18em]">
      {ITEMS.map((it) =>
        it.key === active ? (
          <span key={it.key} className="text-acid">
            {it.label}
          </span>
        ) : (
          <Link key={it.key} href={it.href} className="text-faint transition-colors hover:text-ink">
            {it.label}
          </Link>
        ),
      )}
    </nav>
  );
}
