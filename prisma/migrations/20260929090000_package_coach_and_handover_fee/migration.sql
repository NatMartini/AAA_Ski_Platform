-- A lesson package now belongs to the coach who was paid, and that coach can
-- add or take away hours. Every change is kept, with who made it and why.
CREATE TABLE "PackageAdjustment" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "hours" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackageAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PackageAdjustment_packageId_idx" ON "PackageAdjustment"("packageId");

ALTER TABLE "PackageAdjustment" ADD CONSTRAINT "PackageAdjustment_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "LessonPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PackageAdjustment" ADD CONSTRAINT "PackageAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The handover credit is now the ten minutes' fee at the booked rate rather
-- than a flat amount each coach set. Bookings keep the amount they were
-- charged in Booking.handoverDiscountCents.
ALTER TABLE "CoachProfile" DROP COLUMN "handoverDiscountCents";
