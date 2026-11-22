-- Analysis tiers (2026-11-09): what each analysis shows, and the costliest tier paid for. Older analyses were full ones.
ALTER TABLE "AccountAnalysisJob" ADD COLUMN "tier" TEXT NOT NULL DEFAULT 'COMPLETE', ADD COLUMN "paidTier" TEXT NOT NULL DEFAULT 'COMPLETE';
ALTER TABLE "VideoAnalysisJob" ADD COLUMN "tier" TEXT NOT NULL DEFAULT 'COMPLETE', ADD COLUMN "paidTier" TEXT NOT NULL DEFAULT 'COMPLETE';
