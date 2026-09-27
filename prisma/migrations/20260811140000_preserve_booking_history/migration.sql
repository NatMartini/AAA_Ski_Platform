-- Coach availability is part of the historical booking record. Removing an
-- availability day must therefore be refused instead of cascading into every
-- booking (and its dependent payment proof, waiver invite, and lesson media).
ALTER TABLE "Booking"
  DROP CONSTRAINT "Booking_coachDayId_fkey";

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_coachDayId_fkey"
  FOREIGN KEY ("coachDayId") REFERENCES "CoachDay"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- A coach account can be disabled without erasing the orders and signed
-- waivers for which that coach was responsible. Guard direct/manual deletes
-- at the database boundary as well as in application code.
ALTER TABLE "Booking"
  DROP CONSTRAINT "Booking_coachId_fkey";

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_coachId_fkey"
  FOREIGN KEY ("coachId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Waiver"
  DROP CONSTRAINT "Waiver_coachId_fkey";

ALTER TABLE "Waiver"
  ADD CONSTRAINT "Waiver_coachId_fkey"
  FOREIGN KEY ("coachId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- These list fields were initially added as nullable columns even though the
-- Prisma model and application treat them as arrays. Preserve existing data,
-- replace legacy NULLs with empty arrays, and make future raw-SQL inserts safe.
UPDATE "Booking"
SET "requestedSkills" = ARRAY[]::TEXT[]
WHERE "requestedSkills" IS NULL;

UPDATE "CoachProfile"
SET "teachableSkills" = ARRAY[]::TEXT[]
WHERE "teachableSkills" IS NULL;

UPDATE "CoachProfile"
SET "teachableLevels" = ARRAY[]::TEXT[]
WHERE "teachableLevels" IS NULL;

ALTER TABLE "Booking"
  ALTER COLUMN "requestedSkills" SET DEFAULT ARRAY[]::TEXT[],
  ALTER COLUMN "requestedSkills" SET NOT NULL;

ALTER TABLE "CoachProfile"
  ALTER COLUMN "teachableSkills" SET DEFAULT ARRAY[]::TEXT[],
  ALTER COLUMN "teachableSkills" SET NOT NULL,
  ALTER COLUMN "teachableLevels" SET DEFAULT ARRAY[]::TEXT[],
  ALTER COLUMN "teachableLevels" SET NOT NULL;

-- Revoked waivers are append-only history. Only the currently active waiver
-- must be unique, so a revoked record can be followed by a freshly signed one.
DROP INDEX "Waiver_participantId_coachId_season_templateVersion_key";

CREATE UNIQUE INDEX "Waiver_participantId_coachId_season_templateVersion_key"
  ON "Waiver"("participantId", "coachId", "season", "templateVersion")
  WHERE "revokedAt" IS NULL;
