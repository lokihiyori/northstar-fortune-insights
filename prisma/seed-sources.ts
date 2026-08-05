import { createHash } from "node:crypto";
import type { PrismaClient } from "../src/generated/prisma/client";
import { deterministicEmbedder, toVectorLiteral } from "../src/features/retrieval/embedder";

/**
 * The reviewed corpus retrieval draws on.
 *
 * Real public bodies with hand-written summaries. Each entry is written as
 * passages rather than one blob, because retrieval matches passages — a single
 * long document would return the same chunk for every question.
 *
 * Phase 7 replaces this with admin-managed ingestion; the shape is the same.
 */
type SeedSource = {
  slug: string;
  title: string;
  publisher: string;
  canonicalUrl: string;
  region: string;
  topic: "CAREER" | "EDUCATION" | "RELOCATION" | "PERSONAL_GOAL";
  summary: string;
  passages: string[];
};

const SOURCES: SeedSource[] = [
  {
    slug: "jobbank-outlook",
    title: "Job Bank career and wage outlook",
    publisher: "Government of Canada",
    canonicalUrl: "https://www.jobbank.gc.ca/",
    region: "Canada",
    topic: "CAREER",
    summary:
      "Provincial employment outlook and wage ranges by occupation — the baseline for any claim about demand in a region.",
    passages: [
      "Job Bank publishes employment outlook ratings by occupation and province, describing whether prospects over the coming years are limited, fair, good, or very good. Ratings reflect expected job openings against the expected number of job seekers.",
      "Wage data on Job Bank is reported as low, median, and high hourly or annual figures for each occupation in each region. Median wage is generally a better anchor for planning than the high figure, which reflects experienced workers in senior positions.",
      "Occupational profiles list the usual education, training, and certification requirements for an occupation, including whether a licence or provincial certificate is mandatory rather than optional.",
    ],
  },
  {
    slug: "noc-classification",
    title: "National Occupational Classification",
    publisher: "Employment and Social Development Canada",
    canonicalUrl: "https://noc.esdc.gc.ca/",
    region: "Canada",
    topic: "CAREER",
    summary:
      "Defines what an occupation formally includes, which determines how roles map to immigration and licensing categories.",
    passages: [
      "The National Occupational Classification assigns each occupation a code and a TEER category reflecting the training, education, experience, and responsibilities typically required. Immigration and licensing programs frequently reference these codes directly.",
      "Job titles vary between employers, so the same work may appear under different names. Matching your actual duties to the NOC description matters more than matching your job title when assessing eligibility for a program.",
    ],
  },
  {
    slug: "statcan-lfs",
    title: "Labour Force Survey",
    publisher: "Statistics Canada",
    canonicalUrl: "https://www.statcan.gc.ca/en/subjects-start/labour",
    region: "Canada",
    topic: "CAREER",
    summary:
      "Monthly employment and unemployment data by province and industry, used to sanity-check whether a field is actually growing.",
    passages: [
      "The Labour Force Survey reports monthly employment, unemployment, and participation rates by province, industry, and demographic group. Month-to-month movement is noisy; trends over several months are more informative for a career decision.",
      "Employment growth in an industry does not automatically mean growth in every occupation within it. Industry-level figures should be read alongside occupation-level outlook data.",
    ],
  },
  {
    slug: "cicic-credentials",
    title: "Credential assessment and recognition",
    publisher: "Canadian Information Centre for International Credentials",
    canonicalUrl: "https://www.cicic.ca/",
    region: "Canada",
    topic: "EDUCATION",
    summary:
      "Identifies which body assesses a given international credential — usually the first blocking step for a newcomer.",
    passages: [
      "An educational credential assessment compares a credential earned outside Canada to the Canadian equivalent. Different organisations are designated for different purposes, and an assessment accepted for immigration is not always the one a regulator or employer requires.",
      "For regulated occupations, the provincial or territorial regulatory body — not the assessment service — decides whether an applicant may practise. Confirming which body governs your occupation in your province is the step that determines every subsequent one.",
      "Processing times for credential assessments are commonly measured in weeks to months. Starting an assessment early removes it from the critical path even if other decisions are still open.",
    ],
  },
  {
    slug: "ontario-bridge-training",
    title: "Bridge training programs",
    publisher: "Government of Ontario",
    canonicalUrl: "https://www.ontario.ca/page/bridge-training-programs",
    region: "Ontario",
    topic: "EDUCATION",
    summary:
      "Province-funded programs that close the gap between an international credential and Ontario licensure requirements.",
    passages: [
      "Ontario bridge training programs help internationally trained professionals meet licensing or employment requirements without repeating a full credential. Programs typically combine skills training, workplace experience, and exam preparation.",
      "Bridge training is generally aimed at people who already hold a credential and relevant experience from outside Canada, rather than at people entering a field for the first time.",
    ],
  },
  {
    slug: "cpa-canada-international",
    title: "International accounting credential recognition",
    publisher: "CPA Canada",
    canonicalUrl: "https://www.cpacanada.ca/",
    region: "Canada",
    topic: "EDUCATION",
    summary:
      "Mutual recognition agreements determine how much of the CPA program an internationally designated accountant can skip.",
    passages: [
      "CPA Canada maintains mutual recognition agreements and reciprocal membership agreements with a number of international accounting bodies. Members in good standing of a body covered by an agreement may qualify for the Canadian designation through a shortened route.",
      "Where no agreement exists, an internationally trained accountant generally completes a transcript assessment and then whichever parts of the CPA professional education program are not covered by prior study.",
      "Practical experience requirements are assessed separately from education. Experience gained outside Canada may count, subject to verification and relevance.",
    ],
  },
  {
    slug: "ircc-work-permits",
    title: "Work permits and permanent residence programs",
    publisher: "Immigration, Refugees and Citizenship Canada",
    canonicalUrl: "https://www.canada.ca/en/services/immigration-citizenship.html",
    region: "Canada",
    topic: "RELOCATION",
    summary:
      "The authoritative statement of work-authorization rules. NorthStar links here rather than interpreting eligibility.",
    passages: [
      "Work authorization in Canada depends on status: citizens and permanent residents may work for any employer, while temporary residents may be limited to a specific employer, occupation, or location depending on the permit issued.",
      "Eligibility for permanent residence programs is determined by the department against published criteria. Guidance from any other source, including this one, is informational and cannot confirm eligibility for an individual.",
    ],
  },
  {
    slug: "alberta-alis",
    title: "ALIS career planning resources",
    publisher: "Government of Alberta",
    canonicalUrl: "https://alis.alberta.ca/",
    region: "Alberta",
    topic: "CAREER",
    summary: "Alberta-specific occupational profiles, wage data, and training pathways.",
    passages: [
      "ALIS publishes Alberta occupational profiles covering duties, working conditions, typical earnings, and the education or certification usually required to enter the occupation in the province.",
      "Alberta regulates a number of trades and professions provincially, so entry requirements can differ from other provinces even for the same occupation.",
    ],
  },
  {
    slug: "statcan-tuition",
    title: "Tuition and living accommodation costs",
    publisher: "Statistics Canada",
    canonicalUrl: "https://www.statcan.gc.ca/en/subjects-start/education_training_and_learning",
    region: "Canada",
    topic: "EDUCATION",
    summary:
      "Average program costs by field and province, used to test whether a retraining plan fits a stated budget.",
    passages: [
      "Statistics Canada reports average undergraduate and graduate tuition fees by field of study and province. Fees vary substantially between fields, and between domestic and international students.",
      "Tuition is only part of the cost of study. Living costs, forgone earnings while studying, and materials frequently exceed the tuition figure itself over the length of a program.",
    ],
  },
  {
    slug: "canada-apprenticeship",
    title: "Apprenticeship and skilled trades pathways",
    publisher: "Government of Canada",
    canonicalUrl:
      "https://www.canada.ca/en/employment-social-development/services/apprentices.html",
    region: "Canada",
    topic: "EDUCATION",
    summary:
      "Entry requirements, duration, and financial supports for skilled-trades routes, often overlooked in career pivots.",
    passages: [
      "Apprenticeship combines paid on-the-job training with periods of technical classroom training, typically over two to five years depending on the trade. Apprentices earn a progressively higher percentage of a journeyperson wage as they advance.",
      "Red Seal endorsement allows tradespeople to work in that trade anywhere in Canada without further examination, which matters for anyone who may relocate between provinces.",
      "Financial supports for apprentices include grants and loans specifically for periods of technical training when apprentices are not earning a full wage.",
    ],
  },
  {
    slug: "cra-registered-plans",
    title: "Registered savings plans and contribution limits",
    publisher: "Canada Revenue Agency",
    canonicalUrl: "https://www.canada.ca/en/revenue-agency.html",
    region: "Canada",
    topic: "PERSONAL_GOAL",
    summary:
      "Factual contribution and withdrawal rules. NorthStar cites these but does not give investment advice.",
    passages: [
      "Registered plans have annual contribution limits set in legislation, and unused contribution room generally carries forward. Exceeding the limit attracts a penalty tax on the excess amount.",
      "Some registered plans permit withdrawals for specific purposes such as education or a first home, under conditions including repayment schedules. Withdrawals outside those provisions are normally treated as taxable income.",
    ],
  },
  {
    slug: "bc-settlement",
    title: "Newcomer settlement services",
    publisher: "Government of British Columbia",
    canonicalUrl: "https://www2.gov.bc.ca/",
    region: "British Columbia",
    topic: "RELOCATION",
    summary:
      "Free provincial settlement and employment services, including credential guidance for arrivals in BC.",
    passages: [
      "British Columbia funds settlement services that include employment counselling, language assessment, and help understanding credential recognition requirements for the province. These services are generally free to eligible newcomers.",
      "Provincial services are separate from federal immigration processes. Using them does not affect an immigration application and cannot change its outcome.",
    ],
  },
];

export async function seedSources(prisma: PrismaClient): Promise<number> {
  const embedder = deterministicEmbedder;
  let chunkCount = 0;

  for (const source of SOURCES) {
    // Upsert on the canonical URL so re-seeding updates rather than duplicates.
    const record = await prisma.source.upsert({
      where: { canonicalUrl: source.canonicalUrl },
      update: {
        title: source.title,
        publisher: source.publisher,
        region: source.region,
        topic: source.topic,
        summary: source.summary,
        status: "PUBLISHED",
        reviewedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
      create: {
        title: source.title,
        publisher: source.publisher,
        canonicalUrl: source.canonicalUrl,
        region: source.region,
        topic: source.topic,
        summary: source.summary,
        status: "PUBLISHED",
        reviewedAt: new Date("2026-07-01T00:00:00.000Z"),
        publishedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
      select: { id: true },
    });

    // Replaced wholesale: passage positions shift when text is edited, and a
    // stale chunk would keep being retrieved.
    await prisma.sourceChunk.deleteMany({ where: { sourceId: record.id } });

    const embeddings = await embedder.embed(source.passages);

    for (const [position, text] of source.passages.entries()) {
      const embedding = embeddings[position];
      if (!embedding) continue;

      const created = await prisma.sourceChunk.create({
        data: {
          sourceId: record.id,
          position,
          text,
          checksum: createHash("sha256").update(text).digest("hex").slice(0, 32),
          embeddingModel: embedder.model,
        },
        select: { id: true },
      });

      // Prisma cannot write an Unsupported column, so the vector goes in raw.
      await prisma.$executeRawUnsafe(
        `UPDATE "source_chunks" SET "embedding" = $1::vector WHERE "id" = $2`,
        toVectorLiteral(embedding),
        created.id,
      );

      chunkCount += 1;
    }
  }

  return chunkCount;
}

export const SEED_SOURCE_COUNT = SOURCES.length;
