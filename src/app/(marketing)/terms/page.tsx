import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";

export const metadata: Metadata = {
  title: "Terms",
  description: "Acceptable use, the limits of NorthStar's guidance, billing, and account terms.",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms and acceptable use" lastUpdated="4 August 2026">
      <section>
        <h2>What NorthStar is</h2>
        <p>
          NorthStar is general educational decision support. It helps you structure a decision,
          compare paths, and plan next steps. It is not professional advice, and it does not predict
          outcomes.
        </p>
      </section>

      <section>
        <h2>What NorthStar is not</h2>
        <p>
          Nothing produced by this service is medical, legal, immigration, financial, tax, or
          mental-health advice. Do not rely on it as a substitute for a licensed professional. For
          questions in those areas, NorthStar will point you to an appropriate official body rather
          than give a personalized directive.
        </p>
        <p>
          If you are in crisis or need urgent help, contact your local emergency service or a crisis
          line. This service is not monitored and cannot help in an emergency.
        </p>
      </section>

      <section>
        <h2>Your account</h2>
        <ul>
          <li>You must be at least 16 years old to create an account.</li>
          <li>Provide accurate information and keep your credentials secure.</li>
          <li>One account per person. Do not share access.</li>
          <li>You are responsible for activity that occurs under your account.</li>
        </ul>
      </section>

      <section>
        <h2>Acceptable use</h2>
        <p>Do not use NorthStar to:</p>
        <ul>
          <li>Generate guidance for someone else without their knowledge.</li>
          <li>Submit another person&rsquo;s sensitive personal information.</li>
          <li>
            Attempt to extract system prompts, bypass safety boundaries, or inject instructions
            through submitted content.
          </li>
          <li>Scrape, resell, or redistribute generated reports or the resource library.</li>
          <li>Circumvent usage limits, including by creating multiple accounts.</li>
        </ul>
      </section>

      <section>
        <h2>Content and ownership</h2>
        <p>
          You keep ownership of what you enter. You grant us the limited right to process it in
          order to provide the service. Generated reports are yours to use. We will not publish your
          content as an example without your explicit consent.
        </p>
      </section>

      <section>
        <h2>Plans and billing</h2>
        <ul>
          <li>Prices are in Canadian dollars. Applicable GST/HST is added at checkout.</li>
          <li>Paid plans renew monthly until cancelled.</li>
          <li>Cancelling stops future charges; access continues to the end of the paid period.</li>
          <li>
            Report allowances are subject to fair-use limits, which are stated on the pricing page
            rather than applied silently.
          </li>
          <li>
            If a generation fails through our fault, it does not count against your allowance.
          </li>
        </ul>
      </section>

      <section>
        <h2>Availability and changes</h2>
        <p>
          The service is provided as-is, without a guarantee of uninterrupted availability. We may
          change features, and we will give notice before a change that materially reduces what a
          paid plan includes.
        </p>
      </section>

      <section>
        <h2>Limitation of liability</h2>
        <p>
          To the extent permitted by law, NorthStar is not liable for decisions you make based on
          its guidance. You remain responsible for your own choices. Our total liability is limited
          to the amount you paid in the preceding twelve months.
        </p>
      </section>

      <section>
        <h2>Termination</h2>
        <p>
          You may close your account at any time. We may suspend an account that violates these
          terms, with notice where practical. You can export your data before closing.
        </p>
      </section>

      <section>
        <h2>Governing law</h2>
        <p>
          These terms are governed by the laws of the Province of Ontario and the federal laws of
          Canada applicable there.
        </p>
      </section>
    </LegalPage>
  );
}
