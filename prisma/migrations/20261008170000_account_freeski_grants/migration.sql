-- Add an account wallet without altering existing lesson videos, grants or jobs.
CREATE TABLE "AccountAnalysisGrant" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "note" TEXT,
    "requestKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccountAnalysisGrant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AccountAnalysisGrant_quantity_check" CHECK ("quantity" BETWEEN 1 AND 100)
);

CREATE TABLE "AccountAnalysisVideo" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "caption" TEXT,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccountAnalysisVideo_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AccountAnalysisVideo_owner_check" CHECK ("uploadedById" = "accountId"),
    CONSTRAINT "AccountAnalysisVideo_bytes_check" CHECK ("bytes" > 0 AND "bytes" <= 209715200)
);

CREATE TABLE "AccountAnalysisJob" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "videoId" TEXT,
    "createdById" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "upstreamJobId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "consumedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refundedAt" TIMESTAMP(3),
    "queuedExpiresAt" TIMESTAMP(3) NOT NULL,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "result" JSONB,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AccountAnalysisJob_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AccountAnalysisJob_owner_check" CHECK ("createdById" = "accountId")
);

CREATE UNIQUE INDEX "AccountAnalysisGrant_coachId_requestKey_key" ON "AccountAnalysisGrant"("coachId", "requestKey");
CREATE INDEX "AccountAnalysisGrant_accountId_createdAt_idx" ON "AccountAnalysisGrant"("accountId", "createdAt");
CREATE INDEX "AccountAnalysisGrant_coachId_createdAt_idx" ON "AccountAnalysisGrant"("coachId", "createdAt");
CREATE INDEX "AccountAnalysisVideo_accountId_uploadedAt_idx" ON "AccountAnalysisVideo"("accountId", "uploadedAt");
CREATE UNIQUE INDEX "AccountAnalysisJob_accountId_requestKey_key" ON "AccountAnalysisJob"("accountId", "requestKey");
CREATE INDEX "AccountAnalysisJob_accountId_status_idx" ON "AccountAnalysisJob"("accountId", "status");
CREATE INDEX "AccountAnalysisJob_status_queuedExpiresAt_idx" ON "AccountAnalysisJob"("status", "queuedExpiresAt");
CREATE INDEX "AccountAnalysisJob_status_leaseExpiresAt_idx" ON "AccountAnalysisJob"("status", "leaseExpiresAt");
CREATE INDEX "AccountAnalysisJob_videoId_idx" ON "AccountAnalysisJob"("videoId");

ALTER TABLE "AccountAnalysisGrant" ADD CONSTRAINT "AccountAnalysisGrant_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountAnalysisGrant" ADD CONSTRAINT "AccountAnalysisGrant_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountAnalysisVideo" ADD CONSTRAINT "AccountAnalysisVideo_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountAnalysisJob" ADD CONSTRAINT "AccountAnalysisJob_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountAnalysisJob" ADD CONSTRAINT "AccountAnalysisJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountAnalysisJob" ADD CONSTRAINT "AccountAnalysisJob_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "AccountAnalysisVideo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
