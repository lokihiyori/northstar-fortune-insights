-- CreateEnum
CREATE TYPE "GuidanceTopic" AS ENUM ('CAREER', 'EDUCATION', 'RELOCATION', 'PERSONAL_GOAL');

-- CreateEnum
CREATE TYPE "SourceStatus" AS ENUM ('DRAFT', 'REVIEWED', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'RUNNING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "ConfidenceBasis" AS ENUM ('HIGH_EVIDENCE', 'MISSING_INFORMATION', 'EXPLORATORY');

-- CreateEnum
CREATE TYPE "PathLabel" AS ENUM ('BEST_FIT', 'LOWER_RISK', 'GROWTH');

-- CreateEnum
CREATE TYPE "FitLevel" AS ENUM ('STRONG', 'MODERATE', 'EXPLORATORY');

-- CreateEnum
CREATE TYPE "ReasonType" AS ENUM ('RATIONALE', 'ASSUMPTION', 'TRADEOFF', 'CHANGE_CONDITION');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PlanTaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "FeedbackRating" AS ENUM ('USEFUL', 'PARTLY_USEFUL', 'NOT_USEFUL');

-- CreateTable
CREATE TABLE "sources" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "publisher" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "topic" "GuidanceTopic" NOT NULL,
    "status" "SourceStatus" NOT NULL DEFAULT 'DRAFT',
    "summary" TEXT,
    "publishedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_chunks" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "embeddingModel" TEXT NOT NULL,
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guidance_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "topic" "GuidanceTopic" NOT NULL,
    "question" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "inputSnapshot" JSONB NOT NULL,
    "stageIndex" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "promptVersion" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "guidance_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guidance_reports" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "questionRestatement" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "disclaimer" TEXT NOT NULL,
    "confidenceBasis" "ConfidenceBasis" NOT NULL,
    "confidenceReasons" TEXT[],
    "missingInformation" TEXT[],
    "evidenceSnapshot" JSONB NOT NULL,
    "modelName" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "guidance_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendation_paths" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "label" "PathLabel" NOT NULL,
    "title" TEXT NOT NULL,
    "fit" "FitLevel" NOT NULL,
    "timeHorizon" TEXT NOT NULL,
    "mainTradeoff" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "recommendation_paths_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "path_reasons" (
    "id" TEXT NOT NULL,
    "pathId" TEXT NOT NULL,
    "type" "ReasonType" NOT NULL,
    "body" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "path_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "path_actions" (
    "id" TEXT NOT NULL,
    "pathId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "targetDays" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "path_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "citations" (
    "id" TEXT NOT NULL,
    "pathId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "chunkId" TEXT,
    "claim" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "citations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_plans" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "pathId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "desiredOutcome" TEXT NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "targetDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "action_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_tasks" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "PlanTaskStatus" NOT NULL DEFAULT 'TODO',
    "milestone" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3),
    "notes" TEXT,
    "position" INTEGER NOT NULL,
    "relatedSourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_check_ins" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "changedContext" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_check_ins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "rating" "FeedbackRating" NOT NULL,
    "tags" TEXT[],
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_ledger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 1,
    "periodKey" TEXT NOT NULL,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_versions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "templateHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sources_status_topic_region_idx" ON "sources"("status", "topic", "region");

-- CreateIndex
CREATE UNIQUE INDEX "sources_canonicalUrl_key" ON "sources"("canonicalUrl");

-- CreateIndex
CREATE INDEX "source_chunks_sourceId_idx" ON "source_chunks"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "source_chunks_sourceId_position_key" ON "source_chunks"("sourceId", "position");

-- CreateIndex
CREATE INDEX "guidance_requests_userId_createdAt_idx" ON "guidance_requests"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "guidance_requests_status_idx" ON "guidance_requests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "guidance_requests_userId_idempotencyKey_key" ON "guidance_requests"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "guidance_reports_userId_createdAt_idx" ON "guidance_reports"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "guidance_reports_requestId_version_key" ON "guidance_reports"("requestId", "version");

-- CreateIndex
CREATE INDEX "recommendation_paths_reportId_idx" ON "recommendation_paths"("reportId");

-- CreateIndex
CREATE UNIQUE INDEX "recommendation_paths_reportId_label_key" ON "recommendation_paths"("reportId", "label");

-- CreateIndex
CREATE INDEX "path_reasons_pathId_type_idx" ON "path_reasons"("pathId", "type");

-- CreateIndex
CREATE INDEX "path_actions_pathId_idx" ON "path_actions"("pathId");

-- CreateIndex
CREATE INDEX "citations_pathId_idx" ON "citations"("pathId");

-- CreateIndex
CREATE INDEX "citations_sourceId_idx" ON "citations"("sourceId");

-- CreateIndex
CREATE INDEX "action_plans_userId_status_idx" ON "action_plans"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "action_plans_userId_pathId_key" ON "action_plans"("userId", "pathId");

-- CreateIndex
CREATE INDEX "plan_tasks_planId_milestone_idx" ON "plan_tasks"("planId", "milestone");

-- CreateIndex
CREATE INDEX "plan_check_ins_planId_createdAt_idx" ON "plan_check_ins"("planId", "createdAt");

-- CreateIndex
CREATE INDEX "feedback_reportId_idx" ON "feedback"("reportId");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_userId_reportId_key" ON "feedback"("userId", "reportId");

-- CreateIndex
CREATE INDEX "usage_ledger_userId_periodKey_feature_idx" ON "usage_ledger"("userId", "periodKey", "feature");

-- CreateIndex
CREATE UNIQUE INDEX "usage_ledger_userId_requestId_feature_key" ON "usage_ledger"("userId", "requestId", "feature");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_versions_name_version_key" ON "prompt_versions"("name", "version");

-- AddForeignKey
ALTER TABLE "source_chunks" ADD CONSTRAINT "source_chunks_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guidance_requests" ADD CONSTRAINT "guidance_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guidance_reports" ADD CONSTRAINT "guidance_reports_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "guidance_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guidance_reports" ADD CONSTRAINT "guidance_reports_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation_paths" ADD CONSTRAINT "recommendation_paths_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "guidance_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "path_reasons" ADD CONSTRAINT "path_reasons_pathId_fkey" FOREIGN KEY ("pathId") REFERENCES "recommendation_paths"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "path_actions" ADD CONSTRAINT "path_actions_pathId_fkey" FOREIGN KEY ("pathId") REFERENCES "recommendation_paths"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citations" ADD CONSTRAINT "citations_pathId_fkey" FOREIGN KEY ("pathId") REFERENCES "recommendation_paths"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citations" ADD CONSTRAINT "citations_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citations" ADD CONSTRAINT "citations_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "source_chunks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_plans" ADD CONSTRAINT "action_plans_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_plans" ADD CONSTRAINT "action_plans_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "guidance_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_plans" ADD CONSTRAINT "action_plans_pathId_fkey" FOREIGN KEY ("pathId") REFERENCES "recommendation_paths"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_tasks" ADD CONSTRAINT "plan_tasks_planId_fkey" FOREIGN KEY ("planId") REFERENCES "action_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_check_ins" ADD CONSTRAINT "plan_check_ins_planId_fkey" FOREIGN KEY ("planId") REFERENCES "action_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "guidance_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
