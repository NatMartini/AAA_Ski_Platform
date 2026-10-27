ALTER TABLE "CoachProfile" ADD COLUMN "analysisCreditPriceCents" INTEGER;
ALTER TABLE "CoachProfile" ADD CONSTRAINT "CoachProfile_analysisCreditPriceCents_check"
  CHECK ("analysisCreditPriceCents" IS NULL OR "analysisCreditPriceCents" BETWEEN 1 AND 1000000);

CREATE TABLE "VideoAnalysisJob" (
  "id" TEXT NOT NULL, "bookingId" TEXT NOT NULL, "videoId" TEXT, "createdById" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL, "actionId" TEXT NOT NULL, "upstreamJobId" TEXT, "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "consumedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "refundedAt" TIMESTAMP(3),
  "queuedExpiresAt" TIMESTAMP(3) NOT NULL, "leaseToken" TEXT, "leaseExpiresAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0, "startedAt" TIMESTAMP(3), "finishedAt" TIMESTAMP(3),
  "result" JSONB, "errorCode" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VideoAnalysisJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VideoAnalysisJob_status_check" CHECK ("status" IN ('QUEUED','RUNNING','SUCCEEDED','FAILED')),
  CONSTRAINT "VideoAnalysisJob_refund_check" CHECK ("refundedAt" IS NULL OR "status"='FAILED'),
  CONSTRAINT "VideoAnalysisJob_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VideoAnalysisJob_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "LessonVideo"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "VideoAnalysisJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "VideoAnalysisJob_bookingId_requestKey_key" ON "VideoAnalysisJob"("bookingId","requestKey");
CREATE INDEX "VideoAnalysisJob_bookingId_status_idx" ON "VideoAnalysisJob"("bookingId","status");
CREATE INDEX "VideoAnalysisJob_status_queuedExpiresAt_idx" ON "VideoAnalysisJob"("status","queuedExpiresAt");
CREATE INDEX "VideoAnalysisJob_status_leaseExpiresAt_idx" ON "VideoAnalysisJob"("status","leaseExpiresAt");
CREATE INDEX "VideoAnalysisJob_videoId_idx" ON "VideoAnalysisJob"("videoId");

CREATE TABLE "VideoAnalysisPurchase" (
  "id" TEXT NOT NULL, "bookingId" TEXT NOT NULL, "accountId" TEXT NOT NULL, "payeeCoachId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL, "quantity" INTEGER NOT NULL, "unitPriceCents" INTEGER NOT NULL,
  "totalCents" INTEGER NOT NULL, "currency" TEXT NOT NULL DEFAULT 'CAD',
  "status" TEXT NOT NULL DEFAULT 'AWAITING_PAYMENT', "paymentMethod" "PaymentMethod", "paymentReference" TEXT,
  "paymentSubmittedAt" TIMESTAMP(3), "reviewedById" TEXT, "reviewedAt" TIMESTAMP(3), "reviewNote" TEXT,
  "cancelledAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VideoAnalysisPurchase_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VideoAnalysisPurchase_quantity_check" CHECK ("quantity" BETWEEN 1 AND 50),
  CONSTRAINT "VideoAnalysisPurchase_price_check" CHECK ("unitPriceCents">0 AND "totalCents"="unitPriceCents"*"quantity"),
  CONSTRAINT "VideoAnalysisPurchase_status_check" CHECK ("status" IN ('AWAITING_PAYMENT','PENDING_PAYMENT_REVIEW','PAYMENT_REJECTED','CONFIRMED','CANCELLED')),
  CONSTRAINT "VideoAnalysisPurchase_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VideoAnalysisPurchase_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VideoAnalysisPurchase_payeeCoachId_fkey" FOREIGN KEY ("payeeCoachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VideoAnalysisPurchase_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "VideoAnalysisPurchase_bookingId_requestKey_key" ON "VideoAnalysisPurchase"("bookingId","requestKey");
CREATE INDEX "VideoAnalysisPurchase_bookingId_status_idx" ON "VideoAnalysisPurchase"("bookingId","status");
CREATE INDEX "VideoAnalysisPurchase_payeeCoachId_status_idx" ON "VideoAnalysisPurchase"("payeeCoachId","status");
