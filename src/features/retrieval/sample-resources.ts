export type ResourceTopic = "CAREER" | "EDUCATION" | "RELOCATION" | "PERSONAL_GOAL";
export type ResourceType = "GOVERNMENT" | "REGULATOR" | "STATISTICS" | "EDUCATION_PROVIDER";

export type PublicResource = {
  id: string;
  title: string;
  publisher: string;
  region: string;
  topic: ResourceTopic;
  type: ResourceType;
  reviewedAt: string;
  url: string;
  whyRelevant: string;
};

export const RESOURCE_TYPE_COPY: Record<ResourceType, string> = {
  GOVERNMENT: "Government",
  REGULATOR: "Regulator",
  STATISTICS: "Statistics",
  EDUCATION_PROVIDER: "Education provider",
};

export const RESOURCE_TOPIC_COPY: Record<ResourceTopic, string> = {
  CAREER: "Career",
  EDUCATION: "Education",
  RELOCATION: "Relocation",
  PERSONAL_GOAL: "Personal goal",
};

/**
 * The public resource library shown before sign-in.
 *
 * These are real public bodies with hand-written summaries — they stand in for
 * what Phase 7 ingestion will produce, so the page shows the true card shape
 * (publisher, region, freshness, why it is relevant) rather than a placeholder.
 * Only sources a human has reviewed and published ever reach a report.
 */
export const SAMPLE_RESOURCES: readonly PublicResource[] = [
  {
    id: "res-jobbank",
    title: "Job Bank career and wage outlook",
    publisher: "Government of Canada",
    region: "Canada",
    topic: "CAREER",
    type: "GOVERNMENT",
    reviewedAt: "2026-06-18",
    url: "https://www.jobbank.gc.ca/",
    whyRelevant:
      "Provincial employment outlook and wage ranges by occupation — the baseline for any claim about demand in a given region.",
  },
  {
    id: "res-noc",
    title: "National Occupational Classification",
    publisher: "Employment and Social Development Canada",
    region: "Canada",
    topic: "CAREER",
    type: "GOVERNMENT",
    reviewedAt: "2026-05-02",
    url: "https://noc.esdc.gc.ca/",
    whyRelevant:
      "Defines what an occupation formally includes, which determines how roles map to immigration and licensing categories.",
  },
  {
    id: "res-statcan-lfs",
    title: "Labour Force Survey",
    publisher: "Statistics Canada",
    region: "Canada",
    topic: "CAREER",
    type: "STATISTICS",
    reviewedAt: "2026-07-11",
    url: "https://www.statcan.gc.ca/",
    whyRelevant:
      "Monthly employment and unemployment data by province and industry, used to sanity-check whether a field is actually growing.",
  },
  {
    id: "res-cicic",
    title: "Credential assessment and recognition directory",
    publisher: "Canadian Information Centre for International Credentials",
    region: "Canada",
    topic: "EDUCATION",
    type: "GOVERNMENT",
    reviewedAt: "2026-06-30",
    url: "https://www.cicic.ca/",
    whyRelevant:
      "Identifies which body assesses a given international credential — usually the first blocking step for a newcomer.",
  },
  {
    id: "res-ontario-bridge",
    title: "Bridge training programs",
    publisher: "Government of Ontario",
    region: "Ontario",
    topic: "EDUCATION",
    type: "GOVERNMENT",
    reviewedAt: "2026-04-22",
    url: "https://www.ontario.ca/page/bridge-training-programs",
    whyRelevant:
      "Province-funded programs that close the gap between an international credential and Ontario licensure requirements.",
  },
  {
    id: "res-cpa",
    title: "International accounting credential recognition",
    publisher: "CPA Canada",
    region: "Canada",
    topic: "EDUCATION",
    type: "REGULATOR",
    reviewedAt: "2026-05-19",
    url: "https://www.cpacanada.ca/",
    whyRelevant:
      "Mutual recognition agreements determine how much of the CPA program an internationally designated accountant can skip.",
  },
  {
    id: "res-ircc",
    title: "Work permits and permanent residence programs",
    publisher: "Immigration, Refugees and Citizenship Canada",
    region: "Canada",
    topic: "RELOCATION",
    type: "GOVERNMENT",
    reviewedAt: "2026-07-03",
    url: "https://www.canada.ca/en/services/immigration-citizenship.html",
    whyRelevant:
      "The authoritative statement of work-authorization rules. NorthStar links here rather than interpreting immigration eligibility.",
  },
  {
    id: "res-bc-settlement",
    title: "Newcomer settlement services",
    publisher: "Government of British Columbia",
    region: "British Columbia",
    topic: "RELOCATION",
    type: "GOVERNMENT",
    reviewedAt: "2026-03-14",
    url: "https://www2.gov.bc.ca/",
    whyRelevant:
      "Free provincial settlement and employment services, including credential guidance for arrivals in BC.",
  },
  {
    id: "res-alberta-alis",
    title: "ALIS career planning resources",
    publisher: "Government of Alberta",
    region: "Alberta",
    topic: "CAREER",
    type: "GOVERNMENT",
    reviewedAt: "2026-06-08",
    url: "https://alis.alberta.ca/",
    whyRelevant: "Alberta-specific occupational profiles, wage data, and training pathways.",
  },
  {
    id: "res-statcan-tuition",
    title: "Tuition and living accommodation costs",
    publisher: "Statistics Canada",
    region: "Canada",
    topic: "EDUCATION",
    type: "STATISTICS",
    reviewedAt: "2026-02-27",
    url: "https://www.statcan.gc.ca/",
    whyRelevant:
      "Average program costs by field and province, used to test whether a retraining plan fits a stated budget.",
  },
  {
    id: "res-cra-rrsp",
    title: "Registered savings plans and contribution limits",
    publisher: "Canada Revenue Agency",
    region: "Canada",
    topic: "PERSONAL_GOAL",
    type: "GOVERNMENT",
    reviewedAt: "2026-05-30",
    url: "https://www.canada.ca/en/revenue-agency.html",
    whyRelevant:
      "Factual contribution and withdrawal rules. NorthStar cites these but does not give investment advice.",
  },
  {
    id: "res-cvc",
    title: "Provincial apprenticeship and trades pathways",
    publisher: "Government of Canada",
    region: "Canada",
    topic: "EDUCATION",
    type: "GOVERNMENT",
    reviewedAt: "2026-04-05",
    url: "https://www.canada.ca/en/employment-social-development/services/apprentices.html",
    whyRelevant:
      "Entry requirements, duration, and financial supports for skilled-trades routes, which are often overlooked in career pivots.",
  },
] as const;
