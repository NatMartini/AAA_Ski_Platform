-- Coach verdicts on FreeSki's teaching findings: the labelled set its comparison is calibrated against.
CREATE TYPE "FindingVerdict" AS ENUM ('AGREE', 'DISAGREE');

CREATE TABLE "AnalysisFindingReview" (
  "id" TEXT NOT NULL,
  "scope" "CoachVideoReviewScope" NOT NULL,
  "jobId" TEXT NOT NULL,
  "findingKey" TEXT NOT NULL,
  "coachId" TEXT NOT NULL,
  "verdict" "FindingVerdict" NOT NULL,
  "note" VARCHAR(500),
  "actionId" TEXT NOT NULL,
  "metricKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AnalysisFindingReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnalysisFindingReview_scope_jobId_findingKey_coachId_key" ON "AnalysisFindingReview"("scope", "jobId", "findingKey", "coachId");
CREATE INDEX "AnalysisFindingReview_coachId_updatedAt_idx" ON "AnalysisFindingReview"("coachId", "updatedAt");
CREATE INDEX "AnalysisFindingReview_scope_jobId_idx" ON "AnalysisFindingReview"("scope", "jobId");

ALTER TABLE "AnalysisFindingReview" ADD CONSTRAINT "AnalysisFindingReview_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
