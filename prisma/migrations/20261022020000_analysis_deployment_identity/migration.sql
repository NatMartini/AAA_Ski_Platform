-- Nullable identity pins preserve historical jobs on their legacy API instance.
ALTER TABLE "VideoAnalysisJob" ADD COLUMN "upstreamDeploymentId" TEXT, ADD COLUMN "upstreamApiVersion" INTEGER;
ALTER TABLE "AccountAnalysisJob" ADD COLUMN "upstreamDeploymentId" TEXT, ADD COLUMN "upstreamApiVersion" INTEGER;
