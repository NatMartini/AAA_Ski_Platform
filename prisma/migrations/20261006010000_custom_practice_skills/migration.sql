-- Additive only: retain all existing profiles, orders, prices and signatures.
ALTER TABLE "CoachProfile" ADD COLUMN "customSkills" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Booking" ADD COLUMN "requestedSkillsSnapshot" JSONB NOT NULL DEFAULT '[]';
