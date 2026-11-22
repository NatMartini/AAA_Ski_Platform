-- The report appears only once everything the chosen tier shows has been made (2026-11-09).
ALTER TABLE "AccountAnalysisJob" ADD COLUMN "preparedTier" TEXT, ADD COLUMN "prepareStartedAt" TIMESTAMP(3), ADD COLUMN "preparedAt" TIMESTAMP(3), ADD COLUMN "prepareState" JSONB;
ALTER TABLE "VideoAnalysisJob" ADD COLUMN "preparedTier" TEXT, ADD COLUMN "prepareStartedAt" TIMESTAMP(3), ADD COLUMN "preparedAt" TIMESTAMP(3), ADD COLUMN "prepareState" JSONB;
-- Analyses finished before this are shown as they were: their add-ons are still made when the report is opened.
UPDATE "AccountAnalysisJob" SET "preparedTier" = "tier", "preparedAt" = "finishedAt" WHERE "status" = 'SUCCEEDED';
UPDATE "VideoAnalysisJob" SET "preparedTier" = "tier", "preparedAt" = "finishedAt" WHERE "status" = 'SUCCEEDED';

-- One press of "update the actions" in the admin area.
CREATE TABLE "ActionUpdateRun" (
    "id" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "list" JSONB NOT NULL,
    "steps" JSONB NOT NULL,
    "log" TEXT NOT NULL DEFAULT '',
    "error" TEXT,
    "requestedById" TEXT NOT NULL,
    "heartbeatAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ActionUpdateRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ActionUpdateRun_status_createdAt_idx" ON "ActionUpdateRun"("status", "createdAt");
ALTER TABLE "ActionUpdateRun" ADD CONSTRAINT "ActionUpdateRun_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
