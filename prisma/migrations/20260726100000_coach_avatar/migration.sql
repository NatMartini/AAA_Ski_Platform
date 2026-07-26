-- Storage key for a coach-uploaded profile photo.
--
-- The photo itself lives outside public/ like every other upload, so it is
-- read back through /api/files/avatar/<coachId>. `avatarUrl` keeps holding a
-- URL — now that route — which means the coach cards and the booking page
-- need no change at all.
ALTER TABLE "CoachProfile" ADD COLUMN "avatarKey" TEXT;
