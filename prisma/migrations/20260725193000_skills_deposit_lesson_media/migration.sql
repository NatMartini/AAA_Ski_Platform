-- Skills, deposits, lesson media, and date-of-birth removal.
--
-- The Participant.birthDate -> isMinor change is deliberately done as
-- "add, backfill, then drop" rather than a bare DROP COLUMN. Existing rows
-- carry a real date of birth, and dropping it first would silently reset every
-- child to isMinor = false — which would let a guardian-signed booking through
-- as if the student were an adult. The backfill below derives the flag from the
-- data we are about to discard.
--
-- Dropping the date is the point: the only question the system needs answered
-- is "must a guardian sign", and a full date of birth is more personal data
-- than that question requires.

-- CreateEnum
CREATE TYPE "PaymentPlan" AS ENUM ('FULL', 'DEPOSIT');

-- ── Participant: derive the minor flag, then drop the date of birth ──
ALTER TABLE "Participant" ADD COLUMN "isMinor" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Participant" ADD COLUMN "level" TEXT;

UPDATE "Participant"
SET "isMinor" = true
WHERE "birthDate" IS NOT NULL
  AND "birthDate" > (CURRENT_DATE - INTERVAL '18 years');

-- Carry the existing coarse ability across to the new free-form level, so the
-- auto-assign feature has something to work with for people already on file.
UPDATE "Participant"
SET "level" = CASE "skillLevel"
    WHEN 'FIRST_TIME'   THEN 'first_time'
    WHEN 'BEGINNER'     THEN 'beginner'
    WHEN 'INTERMEDIATE' THEN 'intermediate'
    WHEN 'ADVANCED'     THEN 'advanced'
  END
WHERE "skillLevel" IS NOT NULL;

ALTER TABLE "Participant" DROP COLUMN "birthDate";

-- ── Booking: payment plan, requested skills, post-lesson summary ──
ALTER TABLE "Booking"
  ADD COLUMN "amountPaidCents"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "balanceSettledAt" TIMESTAMP(3),
  ADD COLUMN "coachSummary"     TEXT,
  ADD COLUMN "coachSummaryAt"   TIMESTAMP(3),
  ADD COLUMN "depositCents"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "inviteIsMinor"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "paymentPlan"      "PaymentPlan" NOT NULL DEFAULT 'FULL',
  ADD COLUMN "requestedSkills"  TEXT[],
  ADD COLUMN "studentLevel"     TEXT;

-- Same reasoning as above for the coach-created invite flag.
UPDATE "Booking"
SET "inviteIsMinor" = true
WHERE "inviteBirthDate" IS NOT NULL
  AND "inviteBirthDate" > (CURRENT_DATE - INTERVAL '18 years');

ALTER TABLE "Booking" DROP COLUMN "inviteBirthDate";

-- Existing bookings were all pay-in-full, and any that were already confirmed
-- were paid in full, so seed the running total to match rather than leaving
-- them looking unpaid.
UPDATE "Booking" SET "depositCents" = "totalCents";
UPDATE "Booking"
SET "amountPaidCents" = "totalCents", "balanceSettledAt" = "reviewedAt"
WHERE "status" IN ('CONFIRMED', 'COMPLETED');

-- ── CoachProfile: qualifications and what they teach ──
ALTER TABLE "CoachProfile"
  ADD COLUMN "csiaLevel"       INTEGER,
  ADD COLUMN "csiaParkLevel"   INTEGER,
  ADD COLUMN "teachableLevels" TEXT[],
  ADD COLUMN "teachableSkills" TEXT[];

-- ── Lesson videos ──
CREATE TABLE "LessonVideo" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "caption" TEXT,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LessonVideo_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LessonVideo_bookingId_idx" ON "LessonVideo"("bookingId");

ALTER TABLE "LessonVideo" ADD CONSTRAINT "LessonVideo_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
