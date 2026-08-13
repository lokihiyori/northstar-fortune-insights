-- Billing concurrency and event-order-independent reconciliation (D1/D2/D3).
--
-- Additive and forward-only. No existing column is dropped or retyped, and no
-- label is added to "SubscriptionStatus" — an older generated Prisma Client
-- throws when it deserializes an enum value it does not know, so adding one
-- would make rollback unsafe the moment a single row carried it. Statuses that
-- have no legacy label live in "stripeStatusRaw" instead.

-- CreateEnum
CREATE TYPE "CheckoutAttemptStatus" AS ENUM ('PENDING', 'OPEN', 'COMPLETED', 'EXPIRED', 'FAILED');

-- CreateTable
CREATE TABLE "checkout_attempts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stripeCustomerId" TEXT,
    "activeForUserId" TEXT,
    "status" "CheckoutAttemptStatus" NOT NULL DEFAULT 'PENDING',
    "requestVersion" INTEGER NOT NULL DEFAULT 1,
    "requestedSessionExpiresAt" TIMESTAMP(3) NOT NULL,
    "successUrl" TEXT NOT NULL,
    "cancelUrl" TEXT NOT NULL,
    "stripePriceId" TEXT NOT NULL,
    "allowPromotionCodes" BOOLEAN NOT NULL DEFAULT true,
    "metadataJson" JSONB NOT NULL,
    "customerIdemKey" TEXT NOT NULL,
    "stripeSessionId" TEXT,
    "remoteExpiresAt" TIMESTAMP(3),
    "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkout_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- The correctness constraint: at most one live attempt per user. PostgreSQL
-- permits many NULLs in a unique index, so a terminal attempt (activeForUserId
-- set to NULL) stops competing without being deleted.
CREATE UNIQUE INDEX "checkout_attempts_activeForUserId_key" ON "checkout_attempts"("activeForUserId");

-- CreateIndex
CREATE UNIQUE INDEX "checkout_attempts_customerIdemKey_key" ON "checkout_attempts"("customerIdemKey");

-- CreateIndex
CREATE UNIQUE INDEX "checkout_attempts_stripeSessionId_key" ON "checkout_attempts"("stripeSessionId");

-- CreateIndex
CREATE INDEX "checkout_attempts_userId_createdAt_idx" ON "checkout_attempts"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "checkout_attempts_status_leaseExpiresAt_idx" ON "checkout_attempts"("status", "leaseExpiresAt");

-- AddForeignKey
ALTER TABLE "checkout_attempts" ADD CONSTRAINT "checkout_attempts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "subscriptions"
    ADD COLUMN "stripeStatusRaw" TEXT,
    ADD COLUMN "entitledCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "matchingBlockingCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "reconciledAt" TIMESTAMP(3),
    ADD COLUMN "billingBlockedReason" TEXT,
    ADD COLUMN "reconcileFailureCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "reconcileFailedAt" TIMESTAMP(3);

-- Backfill.
--
-- Without this, an existing PLUS/ACTIVE row would read as entitledCount = 0
-- between deployment and its first live reconciliation, and a paying customer
-- would briefly look unentitled. Entitlement itself still derives from
-- `entitledCount >= 1`, so the counts have to be right from the first request.
--
-- "stripeSubscriptionId IS NOT NULL" is what keeps customer-link-only rows at
-- 0/0. Those are created by linkStripeCustomer before Checkout completes and
-- carry plan = FREE, status = ACTIVE, and no subscription — counting them as
-- live would invent a subscription that does not exist.
--
-- reconciledAt is deliberately left NULL: no live Stripe read has happened.
UPDATE "subscriptions" SET
    "stripeStatusRaw" = lower("status"::text),
    "entitledCount" = CASE
        WHEN "stripeSubscriptionId" IS NOT NULL
         AND "plan" = 'PLUS'
         AND "status" IN ('ACTIVE', 'TRIALING')
        THEN 1 ELSE 0
    END,
    "matchingBlockingCount" = CASE
        WHEN "stripeSubscriptionId" IS NOT NULL
         AND "status" IN ('ACTIVE', 'TRIALING', 'PAST_DUE', 'UNPAID', 'INCOMPLETE')
        THEN 1 ELSE 0
    END;
