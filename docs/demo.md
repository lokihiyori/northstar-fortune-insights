# Recruiter demo

A visibly labelled, isolated, resettable workspace for showing NorthStar in about two minutes.

> **Fictional data only.** The demo account holds an invented profile. It is shared, it is reset
> periodically, and anything typed into it is visible to whoever looks next. **Do not enter personal
> information.**
>
> **No deployment exists.** This runs locally. There is no hosted demo, no real Stripe, and no real
> OpenAI — guidance comes from the deterministic provider and the seeded corpus.

## The two-minute script

| #   | Beat                                                        | What to say                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Enter the demo** — sign-in page → _Explore the demo_      | "No sign-up. Note the banner: this is a demo workspace with fictional data."                                                                                                                                           |
| 2   | **The profile** — `/app/profile`                            | "Our fictional user is an internationally trained accountant who arrived in Toronto eight months ago. Priorities: speed, then income, then stability. Hard constraint: under CAD 3,000."                               |
| 3   | **Ask** — `/app/ask`, topic **Education**                   | Ask: _How do I get my international accounting credential recognised so I can work in Ontario?_                                                                                                                        |
| 4   | **Criteria** — pick _Speed to outcome_ and _Cost_, generate | "The criteria are inputs to deterministic rules, not a prompt."                                                                                                                                                        |
| 5   | **Three paths**                                             | "Best fit, lower risk, growth. Each with a fit level and a time horizon."                                                                                                                                              |
| 6   | **The explainability contract**                             | "Every report carries recommendations, rationale, **evidence**, assumptions, trade-offs, **what would change this**, and next actions. Confidence is stated with its basis — never a fake percentage."                 |
| 7   | **Evidence**                                                | "Citations are validated against the retrieved passages. An unknown source id fails the whole report rather than being repaired."                                                                                      |
| 8   | **Compare** — _Compare the paths_                           | "Side by side, including what would need to be true for each."                                                                                                                                                         |
| 9   | **Action plan** — _Create an action plan_                   | "The chosen path becomes 30/60/90-day tasks."                                                                                                                                                                          |
| 10  | **Update a task**                                           | "Mark one done — progress is counted, not estimated."                                                                                                                                                                  |
| 11  | **History**                                                 | "Reports are versioned and kept."                                                                                                                                                                                      |
| 12  | **Admin, deliberately not shown**                           | "There is a full source lifecycle — draft, reviewed, published, retired — with an append-only audit log. **The demo account is deliberately not an admin**, and that is enforced server-side, not by hiding the link." |

**Close with one engineering decision.** Pick whichever suits the audience:

- **Evidence validation** — model output passes a strict schema _and_ a citation allow-list. An
  unknown `sourceId` rejects the report; malformed output is never repaired.
- **Cache invalidation** — publishing or retiring a source bumps a generation counter, so warm
  caches cannot serve retired evidence. Proved by an integration test that leaves the stale entry
  physically present in Redis.
- **Rate-limit atomicity** — the compare, increment, and expiry are one Lua script; credential
  limits reserve capacity _before_ password verification and refund it afterwards.
- **Deterministic CI** — two flaky accessibility failures were traced to root causes (a mid-flight
  CSS colour transition, and a redirect landing after `goto` resolved) and fixed by asserting real
  conditions, rather than papered over with retries.

## Running it locally

```bash
# 1. Configure demo mode (see .env.example for the full block)
DEMO_MODE_ENABLED="true"
DEMO_ACCOUNT_EMAIL="demo@northstar.local"
DEMO_ACCOUNT_PASSWORD="a-long-random-passphrase"   # 12+ characters

# 2. Create or restore the demo account
pnpm demo:reset

# 3. Run the app; the sign-in page now offers "Explore the demo"
pnpm dev
```

| Variable                   | Purpose                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `DEMO_MODE_ENABLED`        | Off unless exactly `"true"`. Server-side only — there is **no** `NEXT_PUBLIC_` counterpart. |
| `DEMO_ACCOUNT_EMAIL`       | The demo identity. Reserved against ordinary sign-up **even while the flag is off**.        |
| `DEMO_ACCOUNT_PASSWORD`    | Server-side only. Never rendered, logged, or returned by any endpoint.                      |
| `DEMO_ALLOW_IN_PRODUCTION` | Required before demo mode may run with `NODE_ENV=production`. Deliberately unset.           |

## `pnpm demo:reset`

Deletes the demo account and rebuilds it to an exact snapshot. It refuses rather than guesses:

| Guard              | Refuses when                                                                      |
| ------------------ | --------------------------------------------------------------------------------- |
| Flag               | `DEMO_MODE_ENABLED` is not exactly `"true"`                                       |
| Address present    | `DEMO_ACCOUNT_EMAIL` is empty or whitespace                                       |
| Address shape      | wildcards (`*`, `%`), unexpanded `${VAR}`/`%VAR%`, spaces, or multiple addresses  |
| Protected accounts | the address is `dev@northstar.local` or `admin@northstar.local`                   |
| Password           | missing or shorter than 12 characters                                             |
| Production         | `NODE_ENV=production` without `DEMO_ALLOW_IN_PRODUCTION=true`                     |
| Role               | the matched account is not `USER`                                                 |
| Uniqueness         | more than one account matches                                                     |
| Audit history      | the account authored audit entries, which would mean it once held elevated rights |

It is a CLI on purpose — **there is no HTTP reset endpoint**, because one on a shared account is a
denial-of-service handle. It prints a masked identity (`d***o@northstar.local`) and aggregate
counts, never a password, a full address, or row contents.

**What it deletes:** the one demo user row, by id, inside a transaction — cascading to sessions,
accounts, profile, priorities, constraints, requests, reports (paths, reasons, actions, citations),
plans (tasks, check-ins), feedback, usage ledger, and subscription. Demo-owned analytics events are
deleted explicitly first, because that relation is `SetNull` and would otherwise orphan rows.

**What it never touches:** any other user, any source or passage, the retrieval cache, the cache
generation counter, per-IP rate-limit buckets, and the audit log. Redis cleanup removes only keys it
can _compute_ from the demo identity — no scan, no pattern delete, no `FLUSHDB`.

## Post-reset state

|             |                                                                                 |
| ----------- | ------------------------------------------------------------------------------- |
| Account     | one `USER`, never `ADMIN`, no OAuth link, no session                            |
| Profile     | Priya (demo) — internationally trained accountant, Toronto, Ontario             |
| Onboarding  | **complete**, so the demo starts ready to ask                                   |
| Priorities  | Speed (1), Income (2), Stability (3)                                            |
| Constraints | ~10 h/week study; under CAD 3,000 (hard); PR, no work restriction               |
| History     | none — no reports, plans, feedback, or usage rows                               |
| Billing     | Free plan, no subscription. Free allows 3 reports/month, enough for the journey |

**Onboarding is complete rather than pending, deliberately.** A recruiter has two minutes; spending
forty seconds of them in a four-step wizard buries the part worth seeing. The wizard is still
reachable from the profile page if someone asks to see it.

## Limitations

- **Shared account.** Everyone who opens the demo shares one workspace and can see what the previous
  visitor typed. That is why the banner says not to enter personal information.
- **Resets are manual.** `pnpm demo:reset` is run by an operator; nothing is scheduled.
- **Concurrent visitors collide.** Two people demoing at once share the same reports and plans.
- **Rate limits still apply** — 3 generations per 15 minutes for the account, shared across
  visitors. A busy demo can hit that.
- **No deployment**, no real Stripe, no real OpenAI. Billing is refused for the demo account
  server-side, and Stripe remains unverified overall.
- **Not production-ready.** Nothing here has run in production.
