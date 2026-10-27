/**
 * Adds a realistic demo dataset without resetting existing testing edits.
 *
 *   npm run dev:demo
 *   npm run dev:demo -- --sync-kevin-prices
 *   npm run dev:demo -- --enable-wechat
 *   npm run dev:demo -- --analysis-demo
 *
 * Use the account picker with DEV_AUTH_BYPASS=1 to sign in without Google.
 * Optional --cookies prints ordinary signed NextAuth session cookies for
 * manual HTTP checks. Credentials are never printed during normal setup.
 *
 * Refuses to run against NODE_ENV=production.
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import { encode } from "next-auth/jwt";
import { createHash, randomUUID } from "node:crypto";
import { dateKeyToDbDate, toDateKey, torontoWallTimeToUtc } from "../src/lib/time";
import { bookingHorizon } from "../src/lib/season";
import { identityKey } from "../src/lib/participants";
import { lessonWindow, quote } from "../src/lib/pricing";
import { rateFor } from "../src/lib/rates";
import { buildDisclosure } from "../src/lib/booking/disclosure";
import { analysisQuota } from "../src/lib/video-analysis/quota";

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    /* fine */
  }
}

if (process.env.NODE_ENV === "production") {
  console.error("dev:demo refuses to run with NODE_ENV=production");
  process.exit(1);
}

const prisma = new PrismaClient({ log: ["error"] });

const COACH_EMAIL = "kevin.demo@example.com";
const SECOND_COACH_EMAIL = "alisa.demo@example.com";
const STUDENT_EMAIL = "student.demo@example.com";
const GROUP_STUDENTS = [
  { email: "alex.demo@example.com", name: "Alex Chen" },
  { email: "sam.demo@example.com", name: "Sam Li" },
];
// Explicit repair for a demo profile carried over from the old single-rate
// schema. Normal relaunches continue to preserve manual settings edits.
const SYNC_KEVIN_PRICES = process.argv.includes("--sync-kevin-prices");
// Explicitly turn on the requested payment flow for local demo accounts.
// Ordinary launches still preserve payment settings edited during testing.
const ENABLE_WECHAT = process.argv.includes("--enable-wechat");
// An isolated, explicitly requested append. Normal demo setup never invents
// completed lessons. The 2h lesson shares 3 included analyses; the 3h tier has 5.
// Rerunning this option never resets jobs, consumed credits or paid purchases.
const ANALYSIS_DEMO = process.argv.includes("--analysis-demo");
const ANALYSIS_DEMO_CODE = "DEMO-ANALYSIS";
const ANALYSIS_DEMO_NOTE = "功能测试课程 / Functional test only. 无真实课程或实际收款；价格仅为当前演示费率示例。 No real lesson, charge or payment.";

const preservedBookingFields = {
  id: true, code: true, status: true, accountId: true, participantId: true, coachId: true,
  startAt: true, endAt: true, hours: true, headcount: true, hourlyRateCents: true,
  extraPersonCents: true, subtotalCents: true, handoverDiscountCents: true, totalCents: true,
  currency: true, paymentPlan: true, depositCents: true, amountPaidCents: true,
  paymentMethod: true, paymentSubmittedAt: true, reviewedAt: true, waiverId: true,
  holdExpiresAt: true, updatedAt: true,
} as const;
const snapshotHash = (snapshot: unknown) => createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");

async function seedAnalysisDemo() {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ANALYSIS_DEMO_CODE}))`;
    // Snapshot before any write; verification failures roll back the append.
    const before = await tx.booking.findMany({ select: preservedBookingFields, orderBy: { id: "asc" } });
    const coach = await tx.user.findUnique({ where: { email: COACH_EMAIL }, include: { coachProfile: { include: { rates: true } } } });
    const student = await tx.user.findUnique({ where: { email: STUDENT_EMAIL } });
    if (!coach || coach.role !== "COACH" || coach.disabledAt || !student || student.role !== "CUSTOMER" || student.disabledAt) {
      throw new Error("Analysis demo needs the existing, enabled Kevin/Wei demo accounts. No accounts or roles were changed.");
    }
    let booking = await tx.booking.findUnique({ where: { code: ANALYSIS_DEMO_CODE },
      include: { analysisJobs: true, analysisPurchases: true } });
    const alreadyExists = !!booking;
    if (booking && (booking.coachId !== coach.id || booking.accountId !== student.id)) {
      throw new Error("DEMO-ANALYSIS belongs to different accounts; refusing to modify or reuse it.");
    }
    if (!booking) {
      const profile = coach.coachProfile;
      const participant = await tx.participant.findFirst({ where: { accountId: student.id, isSelf: true, isMinor: false, archivedAt: null } });
      const resort = await tx.resort.findFirst({ where: { isActive: true }, orderBy: { order: "asc" } });
      const rate = profile ? rateFor(profile.rates, "riding", false) : null;
      if (!profile || !participant || !resort || !rate) {
        throw new Error("Analysis demo needs Wei's existing adult participant, an active resort and Kevin's riding rate. Existing data was preserved.");
      }
      // Never replace an existing availability day, even an apparently empty
      // one: manual calendar edits are part of the user's testing data.
      let day: Awaited<ReturnType<typeof tx.coachDay.create>> | null = null;
      for (let number = 1; number <= 31; number++) {
        const dateKey = `2026-01-${String(number).padStart(2, "0")}`;
        const date = dateKeyToDbDate(dateKey);
        const candidateStart = torontoWallTimeToUtc(dateKey, 9), candidateEnd = torontoWallTimeToUtc(dateKey, 11);
        if (candidateEnd >= new Date()) continue;
        if (await tx.coachDay.findUnique({ where: { coachId_date: { coachId: coach.id, date } }, select: { id: true } })) continue;
        if (await tx.booking.findFirst({ where: { coachId: coach.id, startAt: { lt: candidateEnd },
          endAt: { gt: candidateStart } }, select: { id: true } })) continue;
        day = await tx.coachDay.create({ data: { coachId: coach.id, resortId: resort.id, date,
          startHour: 9, endHour: 11, note: ANALYSIS_DEMO_NOTE } });
        break;
      }
      if (!day) throw new Error("No untouched January 2026 demo day is available. No booking was changed.");
      const dateKey = day.date.toISOString().slice(0, 10);
      const startAt = torontoWallTimeToUtc(dateKey, 9), endAt = torontoWallTimeToUtc(dateKey, 11);
      const window = lessonWindow(startAt, endAt);
      const priced = quote({ hours: 2, hourlyRateCents: rate.hourlyRateCents, headcount: 1,
        extraPersonCents: profile.extraPersonCents });
      const disclosure = buildDisclosure({ locale: "zh", coach: { displayName: profile.displayName,
        contactEmail: profile.contactEmail, contactPhone: profile.contactPhone, wechatId: profile.wechatId },
        resort: { nameEn: resort.nameEn, nameZh: resort.nameZh }, dateKey, startAt, endAt, ...window,
        quote: priced, lessonType: "riding", earlyBird: false, participantName: participant.fullName,
        cancellationPolicyZh: profile.cancellationPolicyZh ?? "", cancellationPolicyEn: profile.cancellationPolicyEn ?? "" });
      booking = await tx.booking.create({ data: { code: ANALYSIS_DEMO_CODE, accountId: student.id,
        participantId: participant.id, coachId: coach.id, resortId: resort.id, coachDayId: day.id,
        createdByCoach: false, startAt, endAt, ...window, hours: 2, headcount: 1, lessonType: "riding",
        earlyBird: false, hourlyRateCents: priced.hourlyRateCents, extraPersonCents: priced.extraPersonCents,
        subtotalCents: priced.subtotalCents, handoverDiscountCents: priced.handoverDiscountCents,
        totalCents: priced.totalCents, currency: priced.currency, paymentPlan: "FULL", depositCents: priced.totalCents,
        amountPaidCents: 0, status: "COMPLETED", holdExpiresAt: null,
        participantNameSnapshot: participant.fullName, studentLevel: participant.level,
        disclosureSnapshot: disclosure as unknown as Prisma.InputJsonValue,
        notes: ANALYSIS_DEMO_NOTE, coachSummary: ANALYSIS_DEMO_NOTE,
      }, include: { analysisJobs: true, analysisPurchases: true } });
    }
    const after = await tx.booking.findMany({ where: { id: { in: before.map((row) => row.id) } },
      select: preservedBookingFields, orderBy: { id: "asc" } });
    const beforeHash = snapshotHash(before), afterHash = snapshotHash(after);
    if (beforeHash !== afterHash) throw new Error("Existing booking snapshot changed during analysis demo setup; the append was rolled back.");
    return { alreadyExists, code: booking.code, dateKey: toDateKey(booking.startAt),
      quota: analysisQuota(booking, booking.analysisJobs, booking.analysisPurchases), existingCount: before.length,
      beforeHash, afterHash, priceCents: booking.totalCents, amountPaidCents: booking.amountPaidCents };
  });
  console.log(`Analysis demo ${result.alreadyExists ? "preserved" : "created"}: ${result.code}, ${result.dateKey}, 2h.\n` +
    `Whole-lesson shared free allowance ${result.quota.freeTotal}; remaining ${result.quota.remaining}; existing usage/purchases preserved, no video or analysis job was created.\n` +
    `Example price ${result.priceCents} cents; actual received ${result.amountPaidCents} cents.\n` +
    `Verified ${result.existingCount} pre-existing bookings unchanged.\nBefore SHA256 ${result.beforeHash}\nAfter SHA256  ${result.afterHash}\n` +
    `Sign in as ${STUDENT_EMAIL} and open /zh/booking/${result.code} to upload your own MP4/MOV.`);
}

/**
 * The published 2026-27 price sheet, in cents per hour, one-on-one. Alisa
 * does not teach park, so she has no park rate at all.
 */
const PRICE_SHEET = {
  kevin: [
    { lessonType: "riding", earlyBirdCents: 6000, regularCents: 7000 },
    { lessonType: "csia1_prep", earlyBirdCents: 7000, regularCents: 8000 },
    { lessonType: "park", earlyBirdCents: 8000, regularCents: 9000 },
  ],
  alisa: [
    { lessonType: "riding", earlyBirdCents: 5000, regularCents: 6000 },
    { lessonType: "csia1_prep", earlyBirdCents: 6000, regularCents: 7000 },
  ],
};

/** The coaches' own words from the 2026-27 announcement. */
const KEVIN_BIO = {
  zh: "CSIA Level 1 & Snow Park 1。双板入门 / 进阶 / 自由式入门。",
  en: "CSIA Level 1 & Snow Park 1. Beginner and intermediate skiing, intro to freestyle.",
};
const ALISA_BIO = {
  zh: "CSIA Level 1。双板入门 / 进阶。",
  en: "CSIA Level 1. Beginner and intermediate skiing.",
};
const CANCELLATION_POLICY = {
  zh:
    "如需取消或改期,请至少提前 24 小时操作。" +
    "距离上课不足 24 小时取消:定金不退 / 按课时计费。" +
    "因天气、雪场关闭等不可控因素:可协商改期。",
  en:
    "Please cancel or reschedule at least 24 hours before the lesson. " +
    "Cancelling less than 24 hours before: the deposit is not refunded / " +
    "the lesson is charged by the hour. Weather, resort closures or " +
    "anything else out of our control: we will agree a new time together.",
};

/** Refresh existing prices only when the explicit repair option is passed. */
async function setRates(
  profileId: string,
  rates: { lessonType: string; earlyBirdCents: number; regularCents: number }[],
  refresh = false,
) {
  for (const r of rates) {
    await prisma.coachRate.upsert({
      where: { profileId_lessonType: { profileId, lessonType: r.lessonType } },
      update: refresh
        ? { earlyBirdCents: r.earlyBirdCents, regularCents: r.regularCents }
        : {},
      create: { profileId, ...r },
    });
  }
}

/** Cookie name NextAuth v5 uses over plain http. */
const COOKIE_NAME = "authjs.session-token";

async function sessionCookie(userId: string, email: string, name: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.startsWith("replace-me")) {
    throw new Error("Set a real AUTH_SECRET in .env.local first");
  }
  return encode({
    token: {
      sub: userId,
      uid: userId,
      email,
      verifiedGoogleEmail: email.trim().toLowerCase(),
      name,
      tokenIssuedAt: new Date().toISOString(),
    },
    secret,
    salt: COOKIE_NAME,
    maxAge: 24 * 60 * 60,
  });
}

/** Default skills when creating the demo coach profile. */
const DEMO_SKILLS = [
  "first_slide",
  "wedge",
  "wedge_turn",
  "wedge_christie",
  "parallel",
  "short_turn",
  "long_turn",
  "carving",
  "jibbing",
  "box",
  "rail",
];

async function main() {
  if (ANALYSIS_DEMO) {
    await seedAnalysisDemo();
    return;
  }
  const resorts = await prisma.resort.findMany({ orderBy: { order: "asc" } });
  if (resorts.length === 0) {
    throw new Error("Run `npm run db:seed` first — no resorts exist.");
  }
  const [msl, blue] = resorts;

  // ── Coach ──
  const coach = await prisma.user.upsert({
    where: { email: COACH_EMAIL },
    update: {},
    create: {
      email: COACH_EMAIL,
      name: "Kevin",
      role: "COACH",
      emailVerified: new Date(),
    },
  });

  const existingKevinProfile = await prisma.coachProfile.findUnique({
    where: { userId: coach.id },
    select: { id: true },
  });
  const kevinProfile = await prisma.coachProfile.upsert({
    where: { userId: coach.id },
    update: ENABLE_WECHAT ? { wechatPayEnabled: true } : {},
    create: {
      userId: coach.id,
      displayName: "Kevin",
      bioEn: KEVIN_BIO.en,
      bioZh: KEVIN_BIO.zh,
      extraPersonCents: 2000,
      csiaLevel: 1,
      csiaParkLevel: 1,
      teachableLevels: ["first_time", "beginner", "intermediate", "advanced"],
      teachableSkills: DEMO_SKILLS,
      minHours: 2,
      maxHours: 8,
      leadTimeHours: 24,
      emtEnabled: true,
      emtEmail: "kevin.demo@example.com",
      emtName: "Kevin L.",
        wechatId: "kevin-ski-demo",
        wechatPayEnabled: true,
      contactEmail: COACH_EMAIL,
      contactPhone: "+1 416 555 0142",
      cancellationPolicyEn: CANCELLATION_POLICY.en,
      cancellationPolicyZh: CANCELLATION_POLICY.zh,
      icsToken: randomUUID().replace(/-/g, ""),
      isPublished: true,
    },
  });
  if (!existingKevinProfile || SYNC_KEVIN_PRICES) {
    await setRates(kevinProfile.id, PRICE_SHEET.kevin, SYNC_KEVIN_PRICES);
  }

  // ── Second coach, so there is a choice of whose package to buy ──
  const alisa = await prisma.user.upsert({
    where: { email: SECOND_COACH_EMAIL },
    update: {},
    create: {
      email: SECOND_COACH_EMAIL,
      name: "Alisa",
      role: "COACH",
      emailVerified: new Date(),
    },
  });
  const existingAlisaProfile = await prisma.coachProfile.findUnique({
    where: { userId: alisa.id },
    select: { id: true },
  });
  const alisaProfile = await prisma.coachProfile.upsert({
    where: { userId: alisa.id },
    update: ENABLE_WECHAT ? { wechatPayEnabled: true } : {},
    create: {
      userId: alisa.id,
      displayName: "Alisa",
      bioEn: ALISA_BIO.en,
      bioZh: ALISA_BIO.zh,
      extraPersonCents: 2000,
      csiaLevel: 1,
      teachableLevels: ["first_time", "beginner", "intermediate"],
      minHours: 2,
      maxHours: 8,
      leadTimeHours: 24,
      emtEnabled: true,
      emtEmail: SECOND_COACH_EMAIL,
      emtName: "Alisa W.",
        wechatId: "alisa-ski-demo",
        wechatPayEnabled: true,
      contactEmail: SECOND_COACH_EMAIL,
      cancellationPolicyEn: CANCELLATION_POLICY.en,
      cancellationPolicyZh: CANCELLATION_POLICY.zh,
      icsToken: randomUUID().replace(/-/g, ""),
      isPublished: true,
    },
  });
  if (!existingAlisaProfile) await setRates(alisaProfile.id, PRICE_SHEET.alisa);

  // Independent identities make the multi-person signing flow testable.
  for (const guest of GROUP_STUDENTS) {
    const account = await prisma.user.upsert({
      where: { email: guest.email }, update: {},
      create: { ...guest, emailVerified: new Date(), role: "CUSTOMER" },
    });
    await prisma.participant.upsert({
      where: { accountId_identityKey: { accountId: account.id, identityKey: identityKey(guest.name) } },
      update: {},
      create: { accountId: account.id, fullName: guest.name, identityKey: identityKey(guest.name), isMinor: false, isSelf: true },
    });
  }

  // ── Availability, spread across the bookable season ──
  const horizon = bookingHorizon(toDateKey(new Date()));
  const start = dateKeyToDbDate(horizon.from);

  const plan = [
    { offset: 0, resort: msl, startHour: 9, endHour: 16, lunch: true },
    { offset: 1, resort: msl, startHour: 9, endHour: 16, lunch: true },
    { offset: 2, resort: blue ?? msl, startHour: 10, endHour: 16, lunch: true },
    { offset: 5, resort: msl, startHour: 9, endHour: 13, lunch: false },
    { offset: 6, resort: blue ?? msl, startHour: 9, endHour: 16, lunch: true },
    { offset: 8, resort: msl, startHour: 12, endHour: 18, lunch: false },
  ];

  for (const p of plan) {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + p.offset);
    if (date.toISOString().slice(0, 10) > horizon.to) continue;
    await prisma.coachDay.upsert({
      where: { coachId_date: { coachId: coach.id, date } },
      update: {},
      create: {
        coachId: coach.id,
        resortId: p.resort.id,
        date,
        startHour: p.startHour,
        endHour: p.endHour,
        breakStartHour: p.lunch ? 13 : null,
        breakEndHour: p.lunch ? 14 : null,
      },
    });
  }

  const alisaPlan = [
    { offset: 0, resort: blue ?? msl, startHour: 9, endHour: 16, lunch: true },
    { offset: 3, resort: blue ?? msl, startHour: 9, endHour: 16, lunch: true },
    { offset: 4, resort: msl, startHour: 10, endHour: 15, lunch: false },
    { offset: 7, resort: blue ?? msl, startHour: 9, endHour: 16, lunch: true },
  ];
  for (const p of alisaPlan) {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + p.offset);
    if (date.toISOString().slice(0, 10) > horizon.to) continue;
    const window = {
      resortId: p.resort.id,
      startHour: p.startHour,
      endHour: p.endHour,
      breakStartHour: p.lunch ? 13 : null,
      breakEndHour: p.lunch ? 14 : null,
    };
    await prisma.coachDay.upsert({
      where: { coachId_date: { coachId: alisa.id, date } },
      update: {},
      create: { coachId: alisa.id, date, ...window },
    });
  }

  // ── Student, with themselves and a child ──
  const student = await prisma.user.upsert({
    where: { email: STUDENT_EMAIL },
    update: {},
    create: {
      email: STUDENT_EMAIL,
      name: "Wei Zhang",
      emailVerified: new Date(),
    },
  });

  for (const p of [
    { fullName: "Wei Zhang", isMinor: false, isSelf: true },
    { fullName: "小明", isMinor: true, isSelf: false },
  ]) {
    await prisma.participant.upsert({
      where: {
        accountId_identityKey: {
          accountId: student.id,
          identityKey: identityKey(p.fullName),
        },
      },
      update: {},
      create: {
        accountId: student.id,
        fullName: p.fullName,
        isMinor: p.isMinor,
        identityKey: identityKey(p.fullName),
        isSelf: p.isSelf,
        email: p.isSelf ? STUDENT_EMAIL : null,
        emergencyContactName: p.isSelf ? null : "Wei Zhang",
        emergencyContactPhone: p.isSelf ? null : "+1 416 555 0199",
        skillLevel: p.isSelf ? "INTERMEDIATE" : "FIRST_TIME",
      },
    });
  }

  console.log(`
Demo data ready — season ${horizon.season}, availability from ${horizon.from}

  coaches  ${COACH_EMAIL}, ${SECOND_COACH_EMAIL}
  student  ${STUDENT_EMAIL}   (participants: Wei Zhang, 小明)

${SYNC_KEVIN_PRICES
  ? "Kevin's prices were synchronized to the published sheet. Other existing profiles, prices, availability and bookings were preserved."
  : "Existing profiles, prices, availability and bookings were preserved."}
Run npm run launch, then choose an account on the sign-in page.
`);

  if (process.argv.includes("--cookies")) {
    const coachCookie = await sessionCookie(coach.id, COACH_EMAIL, coach.name ?? "Kevin");
    const studentCookie = await sessionCookie(
      student.id,
      STUDENT_EMAIL,
      student.name ?? "Wei Zhang",
    );
    console.log(`Manual development cookies (name: ${COOKIE_NAME})\n\nCOACH_COOKIE=${coachCookie}\n\nSTUDENT_COOKIE=${studentCookie}`);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
