-- Additive: legacy single bookings and their price/waiver records are untouched.
CREATE TABLE "BookingAttendee" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "fullName" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "isMinor" BOOLEAN NOT NULL DEFAULT false,
  "accountId" TEXT,
  "participantId" TEXT,
  "waiverId" TEXT,
  "inviteTokenHash" TEXT,
  "inviteExpiresAt" TIMESTAMP(3),
  "inviteUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BookingAttendee_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BookingAttendee_ordinal_check" CHECK ("ordinal" BETWEEN 1 AND 3),
  CONSTRAINT "BookingAttendee_name_check" CHECK (length(trim("fullName")) > 0),
  CONSTRAINT "BookingAttendee_email_check" CHECK (length(trim("email")) > 0)
);
CREATE UNIQUE INDEX "BookingAttendee_inviteTokenHash_key" ON "BookingAttendee"("inviteTokenHash");
CREATE UNIQUE INDEX "BookingAttendee_bookingId_ordinal_key" ON "BookingAttendee"("bookingId", "ordinal");
CREATE INDEX "BookingAttendee_bookingId_idx" ON "BookingAttendee"("bookingId");
CREATE INDEX "BookingAttendee_accountId_idx" ON "BookingAttendee"("accountId");
CREATE INDEX "BookingAttendee_participantId_idx" ON "BookingAttendee"("participantId");
CREATE INDEX "BookingAttendee_waiverId_idx" ON "BookingAttendee"("waiverId");
ALTER TABLE "BookingAttendee" ADD CONSTRAINT "BookingAttendee_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BookingAttendee" ADD CONSTRAINT "BookingAttendee_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BookingAttendee" ADD CONSTRAINT "BookingAttendee_participantId_fkey"
  FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BookingAttendee" ADD CONSTRAINT "BookingAttendee_waiverId_fkey"
  FOREIGN KEY ("waiverId") REFERENCES "Waiver"("id") ON DELETE SET NULL ON UPDATE CASCADE;
