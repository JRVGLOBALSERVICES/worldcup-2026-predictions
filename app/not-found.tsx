import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[70dvh] max-w-2xl flex-col items-start justify-center px-6">
      <p className="font-mono text-[0.72rem] uppercase tracking-[0.24em] text-acid">Error 404 — page not found · off target</p>
      <h1 className="mt-3 font-display text-4xl font-black uppercase tracking-tight sm:text-5xl">
        That match isn&apos;t on the card.
      </h1>
      <p className="mt-4 text-muted">The fixture you&apos;re after doesn&apos;t exist or has moved.</p>
      <Link
        href="/"
        className="mt-6 rounded-full bg-acid px-5 py-2.5 font-semibold text-pitch transition-opacity hover:opacity-90"
      >
        Back to today&apos;s matches
      </Link>
    </main>
  );
}
