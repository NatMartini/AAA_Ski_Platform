-- Price sheet for the 2026-27 season: one rate per coach per lesson type with
-- an early-bird price, a $10 handover credit (lesson runs 10 past to the hour),
-- $20 per extra student, and prepaid lesson-hour packages.

-- ─── Rates per lesson type ───

CREATE TABLE "CoachRate" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "lessonType" TEXT NOT NULL,
    "regularCents" INTEGER NOT NULL,
    "earlyBirdCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachRate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CoachRate_profileId_lessonType_key" ON "CoachRate"("profileId", "lessonType");

ALTER TABLE "CoachRate" ADD CONSTRAINT "CoachRate_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CoachProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every existing booking was an ordinary lesson, so a coach's single hourly
-- rate becomes their regular ski-lesson rate. Early-bird prices and the other
-- lesson types are entered by each coach in settings.
INSERT INTO "CoachRate" ("id", "profileId", "lessonType", "regularCents", "earlyBirdCents", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'riding', "hourlyRateCents", NULL, CURRENT_TIMESTAMP
FROM "CoachProfile"
WHERE "hourlyRateCents" > 0;

ALTER TABLE "CoachProfile" DROP COLUMN "hourlyRateCents";

-- A per-day price cannot say which lesson type it is for; the published sheet
-- has none, so the override goes rather than silently applying to all types.
ALTER TABLE "CoachDay" DROP COLUMN "hourlyRateCentsOverride";

-- ─── Handover credit and group surcharge ───

-- Move coaches still on the old defaults to the new ones. A coach who had
-- chosen a different figure keeps it.
UPDATE "CoachProfile" SET "handoverDiscountCents" = 1000 WHERE "handoverDiscountCents" = 1500;
UPDATE "CoachProfile" SET "extraPersonCents" = 2000 WHERE "extraPersonCents" = 3000;

ALTER TABLE "CoachProfile"
  ALTER COLUMN "handoverDiscountCents" SET DEFAULT 1000,
  ALTER COLUMN "extraPersonCents" SET DEFAULT 2000;

-- ─── Lesson packages ───

CREATE TYPE "PackageStatus" AS ENUM ('AWAITING_PAYMENT', 'PENDING_PAYMENT_REVIEW', 'PAYMENT_REJECTED', 'ACTIVE', 'CANCELLED');

ALTER TYPE "PaymentPlan" ADD VALUE 'PACKAGE';

CREATE TABLE "LessonPackage" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "offerKey" TEXT NOT NULL,
    "resortId" TEXT NOT NULL,
    "lessonType" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "hours" INTEGER NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "payeeCoachId" TEXT NOT NULL,
    "status" "PackageStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "paymentMethod" "PaymentMethod",
    "paymentProofKey" TEXT,
    "paymentReference" TEXT,
    "paymentSubmittedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LessonPackage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LessonPackage_code_key" ON "LessonPackage"("code");
CREATE INDEX "LessonPackage_accountId_idx" ON "LessonPackage"("accountId");
CREATE INDEX "LessonPackage_payeeCoachId_status_idx" ON "LessonPackage"("payeeCoachId", "status");

ALTER TABLE "LessonPackage" ADD CONSTRAINT "LessonPackage_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LessonPackage" ADD CONSTRAINT "LessonPackage_payeeCoachId_fkey" FOREIGN KEY ("payeeCoachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LessonPackage" ADD CONSTRAINT "LessonPackage_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LessonPackage" ADD CONSTRAINT "LessonPackage_resortId_fkey" FOREIGN KEY ("resortId") REFERENCES "Resort"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Bookings ───

-- Existing bookings were all ordinary lessons at the regular rate.
ALTER TABLE "Booking"
  ADD COLUMN "lessonType" TEXT NOT NULL DEFAULT 'riding',
  ADD COLUMN "earlyBird" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "packageId" TEXT;

CREATE INDEX "Booking_packageId_idx" ON "Booking"("packageId");

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "LessonPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
