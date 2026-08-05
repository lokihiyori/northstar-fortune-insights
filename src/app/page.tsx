const PHASE_0_DELIVERABLES = [
  "Next.js App Router with strict TypeScript",
  "Tailwind, ESLint, and Prettier",
  "Vitest, React Testing Library, and Playwright",
  "PostgreSQL and Redis via Docker Compose",
  "Prisma migration and seed workflow",
  "Continuous integration and architecture decision records",
] as const;

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <div>
        <p className="text-sm font-medium tracking-wide text-teal-700 uppercase">Phase 0</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">NorthStar Fortune Insights</h1>
        <p className="mt-3 text-base leading-relaxed text-slate-600">
          AI guidance for clearer life and career decisions. The foundation is in place; the
          marketing site and product workspace arrive in later phases.
        </p>
      </div>

      <section aria-labelledby="deliverables-heading">
        <h2 id="deliverables-heading" className="text-sm font-semibold text-slate-900">
          Foundation in place
        </h2>
        <ul className="mt-3 space-y-2 text-sm text-slate-600">
          {PHASE_0_DELIVERABLES.map((item) => (
            <li key={item} className="flex gap-2">
              <span aria-hidden="true" className="text-teal-700">
                &#8226;
              </span>
              {item}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
