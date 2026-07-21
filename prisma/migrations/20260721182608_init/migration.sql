-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CUSTOMER', 'COACH', 'ADMIN');

-- CreateEnum
CREATE TYPE "SkillLevel" AS ENUM ('FIRST_TIME', 'BEGINNER', 'INTERMEDIATE', 'ADVANCED');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('HOLD', 'AWAITING_WAIVER', 'AWAITING_PAYMENT', 'PENDING_PAYMENT_REVIEW', 'PAYMENT_REJECTED', 'CONFIRMED', 'EXPIRED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('EMT', 'WECHAT', 'ALIPAY');

-- CreateEnum
CREATE TYPE "UploadedBy" AS ENUM ('CUSTOMER', 'COACH');

-- CreateEnum
CREATE TYPE "SignerRole" AS ENUM ('PARTICIPANT', 'GUARDIAN');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'CUSTOMER',
    "phone" TEXT,
    "wechatId" TEXT,
    "disabledAt" TIMESTAMP(3),
    "tokenInvalidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    "refresh_token_expires_in" INTEGER,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Resort" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameZh" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Toronto',
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Resort_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "bioEn" TEXT,
    "bioZh" TEXT,
    "avatarUrl" TEXT,
    "hourlyRateCents" INTEGER NOT NULL DEFAULT 8000,
    "handoverDiscountCents" INTEGER NOT NULL DEFAULT 1500,
    "minHours" INTEGER NOT NULL DEFAULT 2,
    "maxHours" INTEGER NOT NULL DEFAULT 8,
    "leadTimeHours" INTEGER NOT NULL DEFAULT 24,
    "emtEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emtEmail" TEXT,
    "emtName" TEXT,
    "wechatPayEnabled" BOOLEAN NOT NULL DEFAULT false,
    "wechatPayQrKey" TEXT,
    "alipayEnabled" BOOLEAN NOT NULL DEFAULT false,
    "alipayQrKey" TEXT,
    "wechatId" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "cancellationPolicyEn" TEXT,
    "cancellationPolicyZh" TEXT,
    "icsToken" TEXT NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachDay" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "resortId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startHour" INTEGER NOT NULL,
    "endHour" INTEGER NOT NULL,
    "breakStartHour" INTEGER DEFAULT 13,
    "breakEndHour" INTEGER DEFAULT 14,
    "hourlyRateCentsOverride" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Participant" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "birthDate" DATE NOT NULL,
    "identityKey" TEXT NOT NULL,
    "isSelf" BOOLEAN NOT NULL DEFAULT false,
    "email" TEXT,
    "phone" TEXT,
    "wechatId" TEXT,
    "skillLevel" "SkillLevel",
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "accountId" TEXT,
    "participantId" TEXT,
    "coachId" TEXT NOT NULL,
    "resortId" TEXT NOT NULL,
    "coachDayId" TEXT NOT NULL,
    "createdByCoach" BOOLEAN NOT NULL DEFAULT false,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "hours" INTEGER NOT NULL,
    "lessonStartAt" TIMESTAMP(3) NOT NULL,
    "lessonEndAt" TIMESTAMP(3) NOT NULL,
    "hourlyRateCents" INTEGER NOT NULL,
    "subtotalCents" INTEGER NOT NULL,
    "handoverDiscountCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "disclosureSnapshot" JSONB,
    "confirmationSentAt" TIMESTAMP(3),
    "inviteName" TEXT,
    "inviteEmail" TEXT,
    "inviteBirthDate" DATE,
    "participantNameSnapshot" TEXT,
    "notes" TEXT,
    "status" "BookingStatus" NOT NULL DEFAULT 'HOLD',
    "holdExpiresAt" TIMESTAMP(3),
    "waiverId" TEXT,
    "paymentMethod" "PaymentMethod",
    "paymentProofKey" TEXT,
    "paymentReference" TEXT,
    "paymentSubmittedAt" TIMESTAMP(3),
    "proofUploadedBy" "UploadedBy",
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaiverInvite" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "resentCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaiverInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Waiver" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "templateRevision" INTEGER NOT NULL,
    "templateHash" TEXT NOT NULL,
    "signerUserId" TEXT NOT NULL,
    "signerRole" "SignerRole" NOT NULL,
    "signerName" TEXT NOT NULL,
    "typedName" TEXT NOT NULL,
    "signatureImage" TEXT NOT NULL,
    "participantWasMinor" BOOLEAN NOT NULL,
    "guardianName" TEXT,
    "guardianEmail" TEXT,
    "guardianPhone" TEXT,
    "guardianRelationship" TEXT,
    "consentToElectronic" BOOLEAN NOT NULL,
    "agreedCheckboxes" JSONB NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "signedPdfKey" TEXT NOT NULL,
    "signedPdfSha256" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Waiver_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "Resort_slug_key" ON "Resort"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "CoachProfile_userId_key" ON "CoachProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CoachProfile_icsToken_key" ON "CoachProfile"("icsToken");

-- CreateIndex
CREATE INDEX "CoachDay_date_idx" ON "CoachDay"("date");

-- CreateIndex
CREATE UNIQUE INDEX "CoachDay_coachId_date_key" ON "CoachDay"("coachId", "date");

-- CreateIndex
CREATE INDEX "Participant_accountId_idx" ON "Participant"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_accountId_identityKey_key" ON "Participant"("accountId", "identityKey");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_code_key" ON "Booking"("code");

-- CreateIndex
CREATE INDEX "Booking_coachId_startAt_idx" ON "Booking"("coachId", "startAt");

-- CreateIndex
CREATE INDEX "Booking_status_holdExpiresAt_idx" ON "Booking"("status", "holdExpiresAt");

-- CreateIndex
CREATE INDEX "Booking_accountId_idx" ON "Booking"("accountId");

-- CreateIndex
CREATE INDEX "Booking_coachDayId_idx" ON "Booking"("coachDayId");

-- CreateIndex
CREATE INDEX "Booking_waiverId_idx" ON "Booking"("waiverId");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverInvite_bookingId_key" ON "WaiverInvite"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverInvite_tokenHash_key" ON "WaiverInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "WaiverInvite_email_idx" ON "WaiverInvite"("email");

-- CreateIndex
CREATE INDEX "Waiver_coachId_season_idx" ON "Waiver"("coachId", "season");

-- CreateIndex
CREATE INDEX "Waiver_participantId_idx" ON "Waiver"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "Waiver_participantId_coachId_season_templateVersion_key" ON "Waiver"("participantId", "coachId", "season", "templateVersion");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachProfile" ADD CONSTRAINT "CoachProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachDay" ADD CONSTRAINT "CoachDay_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachDay" ADD CONSTRAINT "CoachDay_resortId_fkey" FOREIGN KEY ("resortId") REFERENCES "Resort"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_resortId_fkey" FOREIGN KEY ("resortId") REFERENCES "Resort"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_coachDayId_fkey" FOREIGN KEY ("coachDayId") REFERENCES "CoachDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_waiverId_fkey" FOREIGN KEY ("waiverId") REFERENCES "Waiver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverInvite" ADD CONSTRAINT "WaiverInvite_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Waiver" ADD CONSTRAINT "Waiver_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Waiver" ADD CONSTRAINT "Waiver_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Waiver" ADD CONSTRAINT "Waiver_signerUserId_fkey" FOREIGN KEY ("signerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
