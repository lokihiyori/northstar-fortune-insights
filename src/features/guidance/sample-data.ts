import type { SampleReport } from "./types";

/**
 * Fictional sample reports used by the marketing site and the `/examples` page.
 *
 * These are hand-written, not model output, and no AI call is made to render
 * them (spec section 5.1). They exist so visitors can see the real report shape
 * — reasoning, evidence, assumptions, trade-offs, and next actions — at zero
 * latency and zero provider cost.
 *
 * Every person here is invented. The cited publishers are real public bodies,
 * which is what a published source looks like once Phase 7 ingestion exists.
 */
export const SAMPLE_REPORTS: readonly SampleReport[] = [
  {
    id: "sample-newcomer-accounting",
    topic: "CAREER",
    profile: {
      id: "profile-amara",
      name: "Amara",
      headline: "Newcomer to Canada, internationally trained accountant",
      region: "Toronto, Ontario",
      careerStage: "8 years experience, credentials from outside Canada",
      constraints: [
        { id: "c-authorization", label: "Permanent resident, no work restriction" },
        { id: "c-time", label: "Needs income within 6 months" },
        { id: "c-budget", label: "Under $3,000 for retraining" },
      ],
      priorities: ["Income", "Stability", "Speed"],
    },
    question:
      "I qualified as an accountant before moving to Canada. What is the most realistic path to working in my field here within a year?",
    summary:
      "Credential recognition and a Canadian-context bridge are the bottleneck, not your experience. Working toward CPA designation while taking a staff accounting role keeps income continuous.",
    confidenceBasis: "MISSING_INFORMATION",
    confidenceReasons: [
      "Your specific credential body and transcript assessment status are not yet known",
      "Provincial requirements are well documented for Ontario",
    ],
    missingInformation: [
      "Which country issued your accounting designation, and whether it has a CPA Canada mutual recognition agreement",
      "Whether a credential assessment has already been completed",
      "How much of your experience was in audit versus industry accounting",
    ],
    paths: [
      {
        id: "path-cpa-bridge",
        label: "BEST_FIT",
        title: "Take a staff accounting role while pursuing CPA recognition",
        fit: "STRONG",
        timeHorizon: "12–18 months to designation",
        mainTradeoff: "Lower starting title than your previous role",
        supportingConstraintIds: ["c-authorization", "c-time", "c-budget"],
        rationale: [
          "Employers hire on demonstrated Canadian workplace experience, which a staff role starts accruing immediately.",
          "CPA Canada has mutual recognition agreements with several international bodies, which can waive a substantial part of the program.",
          "Income continues throughout, which matches your six-month constraint.",
        ],
        assumptions: [
          "Your designation is from a body with a recognition pathway, or your transcripts assess at degree level",
          "You are able to study part-time alongside full-time work",
        ],
        tradeoffs: [
          "You will likely start one level below your previous seniority",
          "Part-time study while working full-time is demanding for roughly a year",
        ],
        changeConditions: [
          "If your body has a full mutual recognition agreement, the timeline shortens considerably and a more senior role becomes reachable sooner",
          "If a credential assessment returns below degree equivalency, a bridging program becomes the first step instead",
        ],
        evidence: [
          {
            sourceId: "src-cpa-intl",
            claim:
              "CPA Canada maintains mutual recognition and reciprocal membership agreements with a number of international accounting bodies.",
            publisher: "CPA Canada",
            region: "Canada",
            url: "https://www.cpacanada.ca/",
          },
          {
            sourceId: "src-oncred",
            claim:
              "Ontario operates bridge training programs for internationally trained professionals seeking licensure in regulated fields.",
            publisher: "Government of Ontario",
            region: "Ontario",
            url: "https://www.ontario.ca/page/bridge-training-programs",
          },
        ],
        nextActions: [
          {
            title: "Confirm your recognition pathway",
            description:
              "Check whether your issuing body appears on CPA Canada's international agreements list. This single answer changes the length of every other step.",
            targetDays: 7,
          },
          {
            title: "Start a credential assessment",
            description:
              "Begin an assessment through a recognized service if you have not already. Processing takes weeks, so starting early removes it from the critical path.",
            targetDays: 14,
          },
          {
            title: "Apply to five staff accounting roles",
            description:
              "Target mid-size firms and industry finance teams, which weigh hands-on experience more heavily than title continuity.",
            targetDays: 30,
          },
        ],
      },
      {
        id: "path-bookkeeping",
        label: "LOWER_RISK",
        title: "Bridge through senior bookkeeping or accounts payable leadership",
        fit: "MODERATE",
        timeHorizon: "2–4 months to income",
        mainTradeoff: "Slower route back to designated work",
        supportingConstraintIds: ["c-time", "c-budget"],
        rationale: [
          "Hiring cycles are shorter and requirements are less credential-dependent, so income starts sooner.",
          "Canadian software and compliance exposure — payroll, GST/HST filing — transfers directly to a later accounting role.",
        ],
        assumptions: [
          "You are willing to hold a non-designated title for a period",
          "Local demand for experienced bookkeepers continues in your area",
        ],
        tradeoffs: [
          "Ceiling on compensation without the designation",
          "Risk of being typecast if you stay longer than about two years",
        ],
        changeConditions: [
          "If you receive a staff accounting offer at any point, that path dominates this one",
          "If your savings runway is longer than you estimated, the faster-income advantage largely disappears",
        ],
        evidence: [
          {
            sourceId: "src-jobbank-bk",
            claim:
              "Job Bank publishes regional outlook and wage data for bookkeeping and accounting technician occupations.",
            publisher: "Government of Canada Job Bank",
            region: "Canada",
            url: "https://www.jobbank.gc.ca/",
          },
        ],
        nextActions: [
          {
            title: "Map your software exposure",
            description:
              "List the accounting systems you have used and note the Canadian equivalents. Named systems get past keyword screening.",
            targetDays: 7,
          },
          {
            title: "Apply to ten postings in two weeks",
            description:
              "Volume matters more here than tailoring, because requirements are more standardized.",
            targetDays: 21,
          },
        ],
      },
      {
        id: "path-analytics",
        label: "GROWTH",
        title: "Move toward financial analysis with a data-skills add-on",
        fit: "EXPLORATORY",
        timeHorizon: "18–24 months",
        mainTradeoff: "Least certain of the three, and your existing credential counts for less",
        supportingConstraintIds: ["c-budget"],
        rationale: [
          "Financial analysis roles weigh modelling and data fluency more heavily than designation status.",
          "Your domain knowledge is a genuine advantage over candidates coming from a pure data background.",
        ],
        assumptions: [
          "You have interest in analytical rather than compliance work",
          "You can invest evenings in building a modelling and SQL portfolio",
        ],
        tradeoffs: [
          "Longest time to a stable senior title",
          "Competes with candidates who already hold Canadian analytics experience",
        ],
        changeConditions: [
          "If you find compliance work unrewarding, this becomes considerably more attractive",
          "If income pressure increases, this path is the first to defer",
        ],
        evidence: [
          {
            sourceId: "src-jobbank-fa",
            claim:
              "Job Bank publishes outlook data for financial and investment analyst occupations by province.",
            publisher: "Government of Canada Job Bank",
            region: "Canada",
            url: "https://www.jobbank.gc.ca/",
          },
        ],
        nextActions: [
          {
            title: "Build one public financial model",
            description:
              "A single well-documented model on a real public company demonstrates more than a certificate.",
            targetDays: 45,
          },
        ],
      },
    ],
    disclaimer:
      "This is general educational guidance, not immigration, licensing, or financial advice. Confirm credential and licensing requirements with the relevant regulatory body.",
  },
  {
    id: "sample-grad-first-role",
    topic: "CAREER",
    profile: {
      id: "profile-devon",
      name: "Devon",
      headline: "Recent computer science graduate weighing two offers",
      region: "Vancouver, British Columbia",
      careerStage: "Graduating in four months, one internship completed",
      constraints: [
        { id: "c-location", label: "Wants to stay in Metro Vancouver" },
        { id: "c-learning", label: "Values mentorship over title" },
        { id: "c-debt", label: "Student loan repayment starts in 10 months" },
      ],
      priorities: ["Learning", "Stability", "Location"],
    },
    question:
      "I have an offer from a 40-person startup and one from a large bank. Which fits someone who wants to learn quickly but cannot afford instability?",
    summary:
      "The bank offer better serves your loan timeline and your stated need for mentorship structure; the startup's learning advantage is real but concentrated in breadth rather than depth.",
    confidenceBasis: "HIGH_EVIDENCE",
    confidenceReasons: [
      "Both offers are concrete and their terms are known",
      "Your priorities are explicitly ranked",
    ],
    missingInformation: [
      "Whether the startup's runway extends past 18 months",
      "Who specifically would mentor you at each organization",
    ],
    paths: [
      {
        id: "path-bank",
        label: "BEST_FIT",
        title: "Accept the bank offer and treat it as a two-year apprenticeship",
        fit: "STRONG",
        timeHorizon: "Decide within 2 weeks",
        mainTradeoff: "Slower feedback loops and narrower scope",
        supportingConstraintIds: ["c-debt", "c-learning", "c-location"],
        rationale: [
          "A predictable salary through the start of loan repayment directly satisfies your hardest constraint.",
          "Large engineering organizations have formal code review and onboarding, which is the structural form of the mentorship you asked for.",
          "Leaving after two years is normal and carries no penalty; leaving a startup early can be harder to frame.",
        ],
        assumptions: [
          "The bank role includes hands-on engineering rather than vendor coordination",
          "Both offers remain open for the full decision window",
        ],
        tradeoffs: [
          "Less product ownership and slower shipping cadence",
          "Technology choices are made above you",
        ],
        changeConditions: [
          "If the bank role turns out to be primarily configuration or vendor management, its learning advantage disappears",
          "If the startup can name a specific senior engineer as your mentor, the comparison narrows sharply",
        ],
        evidence: [
          {
            sourceId: "src-jobbank-swe",
            claim:
              "Job Bank publishes provincial employment outlook for software engineers and designers.",
            publisher: "Government of Canada Job Bank",
            region: "British Columbia",
            url: "https://www.jobbank.gc.ca/",
          },
        ],
        nextActions: [
          {
            title: "Ask both employers who your mentor would be",
            description:
              "Ask for a name and a title, not a policy. The quality of the answer is itself the signal.",
            targetDays: 5,
          },
          {
            title: "Confirm the first-year project scope in writing",
            description:
              "A written scope makes the difference between engineering and coordination visible before you sign.",
            targetDays: 10,
          },
        ],
      },
      {
        id: "path-startup",
        label: "GROWTH",
        title: "Accept the startup offer for breadth and ownership",
        fit: "MODERATE",
        timeHorizon: "Decide within 2 weeks",
        mainTradeoff: "Income stability depends on the company's runway",
        supportingConstraintIds: ["c-learning", "c-location"],
        rationale: [
          "You would touch infrastructure, product, and customer feedback within the first year, which a large organization rarely permits.",
          "Ownership early tends to accelerate the judgment part of engineering, which is the slowest thing to learn.",
        ],
        assumptions: [
          "The company has more than 18 months of runway",
          "You would have at least one senior engineer to learn from",
        ],
        tradeoffs: [
          "A funding shortfall lands directly on your loan timeline",
          "Breadth can come at the cost of depth in any one area",
        ],
        changeConditions: [
          "Confirmed runway beyond two years would move this to the strongest option",
          "A team with no senior engineer would make this the weakest option",
        ],
        evidence: [
          {
            sourceId: "src-bdc-startup",
            claim:
              "BDC publishes guidance on assessing the financial health and runway of early-stage Canadian companies.",
            publisher: "Business Development Bank of Canada",
            region: "Canada",
            url: "https://www.bdc.ca/",
          },
        ],
        nextActions: [
          {
            title: "Ask directly about runway",
            description:
              "Ask how many months of runway remain and when the next raise is planned. A candidate declining to ask is not seen as more polite, only less informed.",
            targetDays: 5,
          },
        ],
      },
      {
        id: "path-defer",
        label: "LOWER_RISK",
        title: "Negotiate a later start date and finish your degree first",
        fit: "EXPLORATORY",
        timeHorizon: "4 months",
        mainTradeoff: "Risks one or both offers being withdrawn",
        supportingConstraintIds: ["c-location"],
        rationale: [
          "A deferred start removes the overlap between final coursework and onboarding.",
          "Graduating without a split focus protects your final grades if they matter for future study.",
        ],
        assumptions: ["At least one employer is willing to defer"],
        tradeoffs: [
          "Deferral requests can be declined outright",
          "Delays the loan-repayment runway you are trying to protect",
        ],
        changeConditions: [
          "If either employer signals inflexibility, this option closes immediately",
        ],
        evidence: [],
        nextActions: [
          {
            title: "Ask about start-date flexibility",
            description:
              "Frame it as a scheduling question rather than a condition, and ask before accepting.",
            targetDays: 3,
          },
        ],
      },
    ],
    disclaimer:
      "This is general educational guidance, not financial or legal advice. Employment terms should be reviewed with the employer directly.",
  },
  {
    id: "sample-midcareer-pivot",
    topic: "EDUCATION",
    profile: {
      id: "profile-priya",
      name: "Priya",
      headline: "Marketing manager considering a move into product management",
      region: "Calgary, Alberta",
      careerStage: "9 years in marketing, currently managing a team of four",
      constraints: [
        { id: "c-family", label: "Two young children, limited evening study time" },
        { id: "c-income", label: "Cannot take an income gap" },
        { id: "c-remote", label: "Open to remote roles" },
      ],
      priorities: ["Impact", "Flexibility", "Learning"],
    },
    question:
      "Do I need a formal product management credential, or can I move internally without going back to school?",
    summary:
      "An internal move is the faster and cheaper route given your constraints. A formal credential would mostly signal what your existing work can already demonstrate.",
    confidenceBasis: "MISSING_INFORMATION",
    confidenceReasons: [
      "Whether your employer has open product roles is unknown",
      "Your existing scope already overlaps with product work",
    ],
    missingInformation: [
      "Whether your current organization has a product team with headcount",
      "How your manager would respond to an internal move",
    ],
    paths: [
      {
        id: "path-internal",
        label: "BEST_FIT",
        title: "Engineer an internal transition through product-adjacent work",
        fit: "STRONG",
        timeHorizon: "6–12 months",
        mainTradeoff: "Depends on your employer having a product function",
        supportingConstraintIds: ["c-family", "c-income", "c-remote"],
        rationale: [
          "You already do discovery, positioning, and prioritization; the gap is title and technical fluency, not capability.",
          "An internal move preserves income and requires no evening study, matching both hard constraints.",
          "Internal candidates are evaluated on demonstrated work rather than credentials.",
        ],
        assumptions: [
          "Your organization has or is creating product roles",
          "Your current performance standing is solid",
        ],
        tradeoffs: [
          "Progress depends on internal politics and timing you do not fully control",
          "May require a lateral title move before an upward one",
        ],
        changeConditions: [
          "If no product function exists internally, an external move becomes the primary path",
          "If a reorganization removes headcount, this timeline extends significantly",
        ],
        evidence: [
          {
            sourceId: "src-jobbank-pm",
            claim:
              "Job Bank publishes outlook and wage data for advertising, marketing, and public relations managers, an occupation group that overlaps with product management hiring.",
            publisher: "Government of Canada Job Bank",
            region: "Alberta",
            url: "https://www.jobbank.gc.ca/",
          },
        ],
        nextActions: [
          {
            title: "Write a one-page product proposal",
            description:
              "Pick a real problem in your product, and write the case: user, evidence, options, recommendation. This is the artifact that gets you taken seriously.",
            targetDays: 21,
          },
          {
            title: "Have an explicit conversation with your manager",
            description:
              "State the direction plainly. Ambiguity here usually reads as disengagement rather than ambition.",
            targetDays: 30,
          },
        ],
      },
      {
        id: "path-external",
        label: "GROWTH",
        title: "Move externally into an associate product role",
        fit: "MODERATE",
        timeHorizon: "6–9 months of searching",
        mainTradeoff: "Likely a title and possibly a compensation step back",
        supportingConstraintIds: ["c-remote", "c-income"],
        rationale: [
          "Remote openness widens your market well beyond Calgary.",
          "Some organizations hire deliberately from marketing into product for the customer-facing instinct.",
        ],
        assumptions: [
          "You can interview during working hours",
          "A lateral or slightly reduced title is acceptable",
        ],
        tradeoffs: [
          "Search effort competes with the same evening hours you do not have",
          "Losing internal context that took years to build",
        ],
        changeConditions: [
          "If an internal path opens, it dominates this on every constraint you listed",
        ],
        evidence: [
          {
            sourceId: "src-statcan-remote",
            claim:
              "Statistics Canada publishes data on the prevalence of hybrid and fully remote work arrangements by industry and province.",
            publisher: "Statistics Canada",
            region: "Canada",
            url: "https://www.statcan.gc.ca/",
          },
        ],
        nextActions: [
          {
            title: "Rewrite your resume around outcomes",
            description:
              "Lead each line with a decision you made and what changed as a result, not the campaign you ran.",
            targetDays: 14,
          },
        ],
      },
      {
        id: "path-credential",
        label: "LOWER_RISK",
        title: "Take a part-time product certificate first",
        fit: "EXPLORATORY",
        timeHorizon: "3–6 months of study",
        mainTradeoff: "Costs the evening time you said you do not have",
        supportingConstraintIds: ["c-income"],
        rationale: [
          "A structured curriculum fills specific vocabulary gaps quickly.",
          "Some hiring managers do treat a credential as a filter, particularly for external applications.",
        ],
        assumptions: ["You can find 4–6 hours per week"],
        tradeoffs: [
          "Directly conflicts with your stated evening constraint",
          "Rarely substitutes for demonstrated product work",
        ],
        changeConditions: [
          "If external applications are repeatedly screened out, a credential becomes more valuable",
          "If your evening availability improves, the cost of this path drops substantially",
        ],
        evidence: [],
        nextActions: [
          {
            title: "Audit one free introductory module first",
            description:
              "Confirm the material teaches something you do not already do before committing money or evenings.",
            targetDays: 14,
          },
        ],
      },
    ],
    disclaimer:
      "This is general educational guidance, not career placement or financial advice. Program requirements should be confirmed with the provider.",
  },
] as const;

export function getSampleReport(id: string): SampleReport | undefined {
  return SAMPLE_REPORTS.find((report) => report.id === id);
}

export const DEFAULT_SAMPLE_REPORT: SampleReport = SAMPLE_REPORTS[0]!;
