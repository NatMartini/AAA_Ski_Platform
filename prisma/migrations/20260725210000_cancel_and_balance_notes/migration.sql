-- Who cancelled a booking, and the coach's note when they record the
-- outstanding balance as settled.
--
-- `cancelledById` is SET NULL on user delete rather than cascade: losing the
-- name of whoever cancelled is acceptable, losing the booking record is not.

ALTER TABLE "Booking" ADD COLUMN "cancelledById" TEXT;
ALTER TABLE "Booking" ADD COLUMN "balanceNote" TEXT;

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_cancelledById_fkey"
  FOREIGN KEY ("cancelledById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Booking_cancelledById_idx" ON "Booking"("cancelledById");
