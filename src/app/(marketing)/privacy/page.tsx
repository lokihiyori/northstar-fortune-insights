import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "What NorthStar collects, why, how long it is kept, and how to get it back or delete it.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" lastUpdated="4 August 2026">
      <section>
        <h2>The short version</h2>
        <p>
          NorthStar collects the minimum needed to give useful guidance. Your reports are private by
          default. We do not sell personal information, and we do not use your questions as public
          examples without your explicit consent.
        </p>
      </section>

      <section>
        <h2>What we collect</h2>
        <ul>
          <li>
            <strong>Account information</strong> — email address, and your name if you provide one.
          </li>
          <li>
            <strong>Compass profile</strong> — region, career or education stage, primary goal,
            timeframe, ranked priorities, and any constraints you enter.
          </li>
          <li>
            <strong>Your questions and generated reports</strong> — including the input snapshot
            each report version was built from.
          </li>
          <li>
            <strong>Plans and progress</strong> — tasks, statuses, notes, and check-ins you create.
          </li>
          <li>
            <strong>Product analytics</strong> — which features are used and how long generation
            takes. Direct identifiers are removed, and the full text of your questions is never sent
            as an analytics property.
          </li>
          <li>
            <strong>Billing</strong> — handled by Stripe. We store a customer and subscription
            reference. We never see or store your card number.
          </li>
        </ul>
      </section>

      <section>
        <h2>What we do not collect</h2>
        <p>
          We do not ask for a government identifier, immigration file number, health record,
          financial account number, or date of birth. If a field is not needed to produce better
          guidance, it is not on the form.
        </p>
      </section>

      <section>
        <h2>What is sent to the AI provider</h2>
        <p>
          Generating a report sends your question, the profile fields shown to you on the review
          step, and the retrieved source passages to our AI provider. The review step exists
          precisely so you can see this before it happens. Your email address and account identifier
          are not included.
        </p>
      </section>

      <section>
        <h2>How long things are kept</h2>
        <ul>
          <li>Reports and plans are kept until you delete them or close your account.</li>
          <li>
            On the Free plan, history older than 30 days becomes read-limited rather than deleted.
          </li>
          <li>Deleted reports are purged from backups within 30 days.</li>
          <li>Raw generation inputs are retained for 30 days for debugging, then discarded.</li>
          <li>Billing and audit records are kept as long as tax and accounting rules require.</li>
        </ul>
      </section>

      <section>
        <h2>Your controls</h2>
        <ul>
          <li>Export everything associated with your account from Settings.</li>
          <li>Delete individual reports, or your entire account, from Settings.</li>
          <li>
            Sharing is off by default. A shared report link is optional, revocable, and expires.
          </li>
          <li>Opt out of product analytics without losing any product functionality.</li>
        </ul>
      </section>

      <section>
        <h2>Where data is stored</h2>
        <p>
          Application data is stored in managed PostgreSQL. Some processing, including the AI
          provider, may occur outside Canada. We will name the regions involved here once
          infrastructure is finalized for launch.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          For access, correction, or deletion requests, or to raise a privacy concern, contact
          privacy@northstarfortune.example. Canadian users may also contact the Office of the
          Privacy Commissioner of Canada.
        </p>
      </section>
    </LegalPage>
  );
}
