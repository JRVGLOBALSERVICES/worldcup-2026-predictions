"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ThemeToggle } from "./ThemeToggle";

export type NavKey =
  | "predictions"
  | "stats"
  | "rj"
  | "ruhan"
  | "thasyan"
  | "sivesh";

const ITEMS: { key: NavKey; href: string; label: string }[] = [
  { key: "predictions", href: "/", label: "Predictions" },
  { key: "stats", href: "/stats", label: "Stats" },
  { key: "rj", href: "/tracker", label: "Rj's Tracker" },
  { key: "ruhan", href: "/tracker/ruhan", label: "Ruhan's Tracker" },
  { key: "thasyan", href: "/tracker/thasyan", label: "Thasyan's Tracker" },
  { key: "sivesh", href: "/tracker/sivesh", label: "Sivesh's Tracker" },
];

/** Shared site nav.
 *  Desktop (sm+): compact top-right channel strip, active tab on the acid rail.
 *  Mobile: a "you-are-here" label + burger that drops a tap-to-close panel —
 *  six mono labels wrapping across three lines was the "looks like shit". */
export function SiteNav({ active }: { active: NavKey }) {
  const [open, setOpen] = useState(false);
  const activeItem = ITEMS.find((it) => it.key === active);

  // Esc closes the mobile panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/* DESKTOP — inline channel strip */}
      <nav className="hidden w-auto items-center justify-end gap-x-4 gap-y-1 font-mono text-[0.7rem] uppercase tracking-[0.18em] sm:flex">
        {ITEMS.map((it) =>
          it.key === active ? (
            <span
              key={it.key}
              data-on="true"
              className="chan whitespace-nowrap font-semibold text-acid"
            >
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

      {/* MOBILE — current-section label + burger */}
      <div className="relative flex items-center justify-between gap-3 sm:hidden">
        <span className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-acid">
          {activeItem?.label ?? "Menu"}
        </span>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            className="inline-flex size-8 shrink-0 flex-col items-center justify-center gap-[5px] rounded-full border border-line text-ink transition-colors hover:border-acid-dim hover:text-acid"
          >
            <span
              className={`h-[1.5px] w-4 bg-current transition-transform duration-200 motion-reduce:transition-none ${
                open ? "translate-y-[6.5px] rotate-45" : ""
              }`}
            />
            <span
              className={`h-[1.5px] w-4 bg-current transition-opacity duration-200 motion-reduce:transition-none ${
                open ? "opacity-0" : ""
              }`}
            />
            <span
              className={`h-[1.5px] w-4 bg-current transition-transform duration-200 motion-reduce:transition-none ${
                open ? "-translate-y-[6.5px] -rotate-45" : ""
              }`}
            />
          </button>
        </div>

        {open && (
          <>
            {/* tap-off backdrop */}
            <button
              aria-hidden
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 cursor-default"
            />
            <div className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-xl border border-line bg-pitch shadow-xl">
              <ul className="flex flex-col py-1">
                {ITEMS.map((it) => (
                  <li key={it.key}>
                    {it.key === active ? (
                      <span className="flex items-center justify-between px-4 py-2.5 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-acid">
                        {it.label}
                        <span className="size-1.5 rounded-full bg-acid" />
                      </span>
                    ) : (
                      <Link
                        href={it.href}
                        onClick={() => setOpen(false)}
                        className="block px-4 py-2.5 font-mono text-[0.72rem] uppercase tracking-[0.14em] text-faint transition-colors hover:bg-line/40 hover:text-ink"
                      >
                        {it.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </>
  );
}
