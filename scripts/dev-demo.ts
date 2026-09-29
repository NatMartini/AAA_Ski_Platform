/**
 * Populates a realistic demo dataset and prints sign-in cookies for it.
 *
 *   npm run dev:demo
 *
 * DEVELOPMENT ONLY. It mints NextAuth session cookies directly using
 * AUTH_SECRET, which is how you can look at the signed-in UI without Google
 * OAuth credentials configured. Nothing in the application itself is weakened
 * to make this work — there is no bypass route and no test provider; the
 * cookies are ordinary session JWTs signed outside the app.
 *
 * Refuses to run against NODE_ENV=production.
 */
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";
import { randomUUID } from "node:crypto";
import { dateKeyToDbDate, toDateKey } from "../src/lib/time";
import { bookingHorizon } from "../src/lib/season";
import { identityKey } from "../src/lib/participants";

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

/** Replaces a coach's rate card with the given rows. */
async function setRates(
  profileId: string,
  rates: { lessonType: string; earlyBirdCents: number; regularCents: number }[],
) {
  await prisma.coachRate.deleteMany({
    where: {
      profileId,
      lessonType: { notIn: rates.map((r) => r.lessonType) },
    },
  });
  for (const r of rates) {
    await prisma.coachRate.upsert({
      where: { profileId_lessonType: { profileId, lessonType: r.lessonType } },
      update: { earlyBirdCents: r.earlyBirdCents, regularCents: r.regularCents },
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
      name,
      tokenIssuedAt: new Date().toISOString(),
    },
    secret,
    salt: COOKIE_NAME,
    maxAge: 24 * 60 * 60,
  });
}

/** What the demo coach teaches, used for both create and update. */
const DEMO_SKILLS = [
  "first_slide",
  "wedge",
  "wedge_turn",
  "wedge_christie",
  "parallel",
  "short_turn",
  "long_turn",
  "carving",
  "park_intro",
  "box_rail",
];

async function main() {
  const resorts = await prisma.resort.findMany({ orderBy: { order: "asc" } });
  if (resorts.length === 0) {
    throw new Error("Run `npm run db:seed` first — no resorts exist.");
  }
  const [msl, blue] = resorts;

  // ── Coach ──
  const coach = await prisma.user.upsert({
    where: { email: COACH_EMAIL },
    update: { role: "COACH", name: "Kevin" },
    create: {
      email: COACH_EMAIL,
      name: "Kevin",
      role: "COACH",
      emailVerified: new Date(),
    },
  });

  const kevinProfile = await prisma.coachProfile.upsert({
    where: { userId: coach.id },
    // Refreshed rather than left alone: re-running the demo after adding a
    // profile field should show that field, not the row from three weeks ago.
    update: {
      csiaLevel: 1,
      csiaParkLevel: 1,
      teachableLevels: ["first_time", "beginner", "intermediate", "advanced"],
      teachableSkills: DEMO_SKILLS,
      extraPersonCents: 2000,
      bioEn: KEVIN_BIO.en,
      bioZh: KEVIN_BIO.zh,
      cancellationPolicyEn: CANCELLATION_POLICY.en,
      cancellationPolicyZh: CANCELLATION_POLICY.zh,
    },
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
      contactEmail: COACH_EMAIL,
      contactPhone: "+1 416 555 0142",
      cancellationPolicyEn: CANCELLATION_POLICY.en,
      cancellationPolicyZh: CANCELLATION_POLICY.zh,
      icsToken: randomUUID().replace(/-/g, ""),
      isPublished: true,
    },
  });
  await setRates(kevinProfile.id, PRICE_SHEET.kevin);

  // ── Second coach, so there is a choice of whose package to buy ──
  const alisa = await prisma.user.upsert({
    where: { email: SECOND_COACH_EMAIL },
    update: { role: "COACH", name: "Alisa" },
    create: {
      email: SECOND_COACH_EMAIL,
      name: "Alisa",
      role: "COACH",
      emailVerified: new Date(),
    },
  });
  const alisaProfile = await prisma.coachProfile.upsert({
    where: { userId: alisa.id },
    update: {
      teachableLevels: ["first_time", "beginner", "intermediate"],
      extraPersonCents: 2000,
      bioEn: ALISA_BIO.en,
      bioZh: ALISA_BIO.zh,
      cancellationPolicyEn: CANCELLATION_POLICY.en,
      cancellationPolicyZh: CANCELLATION_POLICY.zh,
    },
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
      contactEmail: SECOND_COACH_EMAIL,
      cancellationPolicyEn: CANCELLATION_POLICY.en,
      cancellationPolicyZh: CANCELLATION_POLICY.zh,
      icsToken: randomUUID().replace(/-/g, ""),
      isPublished: true,
    },
  });
  await setRates(alisaProfile.id, PRICE_SHEET.alisa);

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
    await prisma.coachDay.upsert({
      where: { coachId_date: { coachId: coach.id, date } },
      update: {
        resortId: p.resort.id,
        startHour: p.startHour,
        endHour: p.endHour,
        breakStartHour: p.lunch ? 13 : null,
        breakEndHour: p.lunch ? 14 : null,
      },
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
    const window = {
      resortId: p.resort.id,
      startHour: p.startHour,
      endHour: p.endHour,
      breakStartHour: p.lunch ? 13 : null,
      breakEndHour: p.lunch ? 14 : null,
    };
    await prisma.coachDay.upsert({
      where: { coachId_date: { coachId: alisa.id, date } },
      update: window,
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

  const coachCookie = await sessionCookie(coach.id, COACH_EMAIL, "Kevin");
  const studentCookie = await sessionCookie(
    student.id,
    STUDENT_EMAIL,
    "Wei Zhang",
  );

  console.log(`
Demo data ready — season ${horizon.season}, availability from ${horizon.from}

  coaches  ${COACH_EMAIL}, ${SECOND_COACH_EMAIL}
  student  ${STUDENT_EMAIL}   (participants: Wei Zhang, 小明)

Sign in by setting this cookie on http://localhost:3000 —
  name: ${COOKIE_NAME}

COACH_COOKIE=${coachCookie}

STUDENT_COOKIE=${studentCookie}
`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
