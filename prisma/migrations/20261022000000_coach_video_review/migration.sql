-- Optional human video feedback: independent of analysis credits and payment review.
CREATE TYPE "CoachVideoReviewStatus" AS ENUM ('NOT_REQUESTED', 'REQUESTED', 'IN_REVIEW', 'PUBLISHED', 'CANCELLED');
CREATE TYPE "CoachVideoReviewScope" AS ENUM ('LESSON', 'ACCOUNT');
CREATE TABLE "CoachVideoReviewRequest" (
  "id" TEXT NOT NULL, "accountId" TEXT NOT NULL, "coachId" TEXT NOT NULL,
  "scope" "CoachVideoReviewScope" NOT NULL, "sourceVideoId" TEXT NOT NULL,
  "lessonVideoId" TEXT, "accountVideoId" TEXT, "bookingId" TEXT,
  "requestKey" TEXT NOT NULL, "status" "CoachVideoReviewStatus" NOT NULL DEFAULT 'REQUESTED',
  "revision" INTEGER NOT NULL DEFAULT 1, "consentVersion" TEXT NOT NULL,
  "consentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sourceVersion" TEXT NOT NULL, "captionSnapshot" TEXT, "analysisSnapshot" JSONB,
  "draftText" TEXT, "publishedText" TEXT, "videoViewedAt" TIMESTAMP(3), "authoredAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3), "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CoachVideoReviewRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CoachVideoReviewRequest_scope_check" CHECK (
    ("scope" = 'LESSON' AND "accountVideoId" IS NULL) OR
    ("scope" = 'ACCOUNT' AND "lessonVideoId" IS NULL AND "bookingId" IS NULL)),
  CONSTRAINT "CoachVideoReviewRequest_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "CoachVideoReviewRequest_not_self" CHECK ("accountId" <> "coachId"),
  CONSTRAINT "CoachVideoReviewRequest_published_check" CHECK (
    "status" <> 'PUBLISHED' OR ("publishedAt" IS NOT NULL AND "authoredAt" IS NOT NULL AND
      "videoViewedAt" IS NOT NULL AND "publishedText" IS NOT NULL AND length(btrim("publishedText")) > 0))
);
CREATE UNIQUE INDEX "CoachVideoReviewRequest_accountId_requestKey_key" ON "CoachVideoReviewRequest"("accountId", "requestKey");
CREATE INDEX "CoachVideoReviewRequest_accountId_scope_sourceVideoId_creat_idx" ON "CoachVideoReviewRequest"("accountId", "scope", "sourceVideoId", "createdAt");
CREATE INDEX "CoachVideoReviewRequest_coachId_status_updatedAt_idx" ON "CoachVideoReviewRequest"("coachId", "status", "updatedAt");
CREATE INDEX "CoachVideoReviewRequest_lessonVideoId_idx" ON "CoachVideoReviewRequest"("lessonVideoId");
CREATE INDEX "CoachVideoReviewRequest_accountVideoId_idx" ON "CoachVideoReviewRequest"("accountVideoId");
CREATE INDEX "CoachVideoReviewRequest_bookingId_idx" ON "CoachVideoReviewRequest"("bookingId");
-- Prisma cannot express this partial uniqueness. Historical cancelled requests remain auditable.
CREATE UNIQUE INDEX "CoachVideoReviewRequest_current_video_key" ON "CoachVideoReviewRequest"("accountId", "scope", "sourceVideoId") WHERE "status" IN ('REQUESTED', 'IN_REVIEW', 'PUBLISHED');
ALTER TABLE "CoachVideoReviewRequest" ADD CONSTRAINT "CoachVideoReviewRequest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CoachVideoReviewRequest" ADD CONSTRAINT "CoachVideoReviewRequest_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CoachVideoReviewRequest" ADD CONSTRAINT "CoachVideoReviewRequest_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CoachVideoReviewRequest" ADD CONSTRAINT "CoachVideoReviewRequest_lessonVideoId_fkey" FOREIGN KEY ("lessonVideoId") REFERENCES "LessonVideo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CoachVideoReviewRequest" ADD CONSTRAINT "CoachVideoReviewRequest_accountVideoId_fkey" FOREIGN KEY ("accountVideoId") REFERENCES "AccountAnalysisVideo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
