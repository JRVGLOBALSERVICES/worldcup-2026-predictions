"use client";

import { useEffect, useState } from "react";

/**
 * Light/dark toggle. Light is the default; dark is opt-in and persisted to
 * localStorage under "theme". The actual class flip happens on <html> (the
 * no-flash script in layout.tsx sets it before paint, reading the same key),
 * so this button only mirrors + writes that state. Renders a neutral shell on
 * the server, then syncs to the real class on mount to avoid hydration drift.
 */
export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setMounted(true);
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    const root = document.documentElement;
    root.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      /* private mode — ignore, session-only toggle still works */
    }
  }

  const label = dark ? "Switch to light programme" : "Switch to dark programme";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      aria-pressed={mounted ? dark : undefined}
      title={label}
      className="group inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-line text-faint transition-colors hover:border-acid-dim hover:text-acid"
    >
      {/* Sun when dark (tap → light) · Moon when light (tap → dark). Before mount,
       * show the moon (matches the light default) so there's no visible swap. */}
      {mounted && dark ? (
        <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden>
          <circle cx="12" cy="12" r="4" fill="currentColor" />
          <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5 5l1.6 1.6M17.4 17.4L19 19M19 5l-1.6 1.6M6.6 17.4L5 19" />
          </g>
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden>
          <path
            d="M20 14.5A8 8 0 1 1 9.5 4a6.3 6.3 0 0 0 10.5 10.5Z"
            fill="currentColor"
          />
        </svg>
      )}
    </button>
  );
}
