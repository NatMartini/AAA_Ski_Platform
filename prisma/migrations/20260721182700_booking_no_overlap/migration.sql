-- Prevent a coach from ever being double-booked.
--
-- An application-level "is this slot free?" check loses to a race: two requests
-- can both read "free" before either writes. This constraint makes the overlap
-- impossible at the storage layer, so the worst case is one request failing
-- with SQLSTATE 23P01 (exclusion_violation), which the API turns into a 409.
--
-- tsrange, not tstzrange: Prisma maps DateTime to `timestamp(3)` (without time
-- zone), and casting that to timestamptz depends on the session TimeZone, which
-- makes the expression non-IMMUTABLE and therefore unusable in an index. Every
-- value written to these columns is already a UTC instant, so comparing them as
-- naive timestamps is correct.
--
-- The default '[)' bounds are what we want: a 9-11 booking and an 11-13 booking
-- touch at 11:00 but do not overlap.
--
-- The status list must stay in sync with OCCUPYING_STATUSES in
-- src/lib/booking/state.ts. Expired, cancelled and completed bookings release
-- the slot and so are excluded here.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Booking"
  ADD CONSTRAINT "booking_no_overlap"
  EXCLUDE USING gist (
    "coachId" WITH =,
    tsrange("startAt", "endAt") WITH &&
  )
  WHERE (
    "status" IN (
      'HOLD',
      'AWAITING_WAIVER',
      'AWAITING_PAYMENT',
      'PENDING_PAYMENT_REVIEW',
      'PAYMENT_REJECTED',
      'CONFIRMED'
    )
  );
