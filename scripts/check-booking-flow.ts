/**
 * End-to-end exercise of the booking domain against the real database.
 *
 * Covers what unit tests cannot: the create-booking transaction, the waiver
 * signing pipeline (including PDF generation), waiver reuse across bookings,
 * the guardian/aged-out rules, lesson-type and early-bird pricing, and
 * spending a lesson package with two coaches — all against live Postgres.
 *
 *   npm run check:flow
 *
 * Creates and removes its own fixtures under __flow_check ids.
 */
import { PrismaClient } from "@prisma/client";
import {
  createBooking,
  sweepExpiredHolds,
} from "../src/lib/booking/create";
import { signWaiver } from "../src/lib/waiver/sign";
import { resolveWaiver } from "../src/lib/waiver/validity";
import { acknowledgementIds } from "../src/lib/waiver/template-v1";
import { identityKey } from "../src/lib/participants";
import { dateKeyToDbDate, torontoWallTimeToUtc } from "../src/lib/time";
import { deleteObject, readObject } from "../src/lib/storage";
import {
  amountDueCents,
  balanceCents,
  stageOf,
} from "../src/lib/booking/lesson";
import { OCCUPYING_STATUSES } from "../src/lib/booking/state";
import { bookingInclude } from "../src/lib/booking/access";
import { hoursUsed } from "../src/lib/packages";

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    /* fine */
  }
}

const prisma = new PrismaClient({ log: ["error"] });

const COACH = "__flow_check_coach";
// A second coach, to spend a package paid to the first one.
const COACH2 = "__flow_check_coach2";
const PARENT = "__flow_check_parent";
const ADULT = "__flow_check_adult";
const RESORT_SLUG = "__flow_check_resort";
const DAY = "2026-01-08";
// A second open day, so the deposit and cancellation checks are not fighting
// the earlier tests for the few free hours left on DAY.
const DAY2 = "2026-01-09";

// A 1x1 PNG stands in for a drawn signature.
const SIG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let failures = 0;

function check(label: string, condition: boolean, detail = ""): void {
  if (!condition) failures++;
  console.log(`  ${condition ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
}

async function cleanup() {
  const users = [COACH, COACH2, PARENT, ADULT];
  const coaches = [COACH, COACH2];
  const waiverFiles = await prisma.waiver.findMany({
    where: { coachId: { in: coaches } },
    select: { signedPdfKey: true },
  });
  for (const waiver of waiverFiles) {
    await deleteObject(waiver.signedPdfKey).catch(() => undefined);
  }
  await prisma.waiver.deleteMany({ where: { coachId: { in: coaches } } });
  await prisma.booking.deleteMany({ where: { coachId: { in: coaches } } });
  await prisma.lessonPackage.deleteMany({ where: { accountId: { in: users } } });
  await prisma.participant.deleteMany({ where: { accountId: { in: users } } });
  await prisma.coachDay.deleteMany({ where: { coachId: { in: coaches } } });
  await prisma.coachProfile.deleteMany({ where: { userId: { in: coaches } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.resort.deleteMany({ where: { slug: RESORT_SLUG } });
}

async function setup() {
  await prisma.user.create({
    data: { id: COACH, email: "__flow_coach@example.invalid", name: "Kevin", role: "COACH" },
  });
  await prisma.user.create({
    data: { id: COACH2, email: "__flow_coach2@example.invalid", name: "Alisa", role: "COACH" },
  });
  await prisma.user.create({
    data: { id: PARENT, email: "__flow_parent@example.invalid", name: "张丽" },
  });
  await prisma.user.create({
    data: { id: ADULT, email: "__flow_adult@example.invalid", name: "张伟" },
  });

  const resort = await prisma.resort.create({
    data: { slug: RESORT_SLUG, nameEn: "Flow Test Hill", nameZh: "测试雪场" },
  });

  // The price sheet: Kevin teaches all three types; Alisa has no park rate.
  const sheet = {
    [COACH]: [
      { lessonType: "riding", earlyBirdCents: 6000, regularCents: 7000 },
      { lessonType: "csia1_prep", earlyBirdCents: 7000, regularCents: 8000 },
      { lessonType: "park", earlyBirdCents: 8000, regularCents: 9000 },
    ],
    [COACH2]: [
      { lessonType: "riding", earlyBirdCents: 5000, regularCents: 6000 },
      { lessonType: "csia1_prep", earlyBirdCents: 6000, regularCents: 7000 },
    ],
  };
  for (const [userId, name] of [
    [COACH, "Kevin"],
    [COACH2, "Alisa"],
  ] as const) {
    await prisma.coachProfile.create({
      data: {
        userId,
        displayName: name,
        extraPersonCents: 2000,
        minHours: 2,
        maxHours: 8,
        leadTimeHours: 0,
        emtEnabled: true,
        emtEmail: `${userId}@example.invalid`,
        cancellationPolicyEn: "48h full refund.",
        cancellationPolicyZh: "48 小时前全额退款。",
        icsToken: `${userId}_token`,
        isPublished: true,
        rates: { create: sheet[userId] },
      },
    });

    for (const day of [DAY, DAY2]) {
      await prisma.coachDay.create({
        data: {
          coachId: userId,
          resortId: resort.id,
          date: dateKeyToDbDate(day),
          startHour: 9,
          endHour: 16,
          breakStartHour: 13,
          breakEndHour: 14,
        },
      });
    }
  }

  const child = await prisma.participant.create({
    data: {
      accountId: PARENT,
      fullName: "小明",
      isMinor: true,
      identityKey: identityKey("小明"),
      isSelf: false,
    },
  });
  const adult = await prisma.participant.create({
    data: {
      accountId: ADULT,
      fullName: "张伟",
      isMinor: false,
      identityKey: identityKey("张伟"),
      isSelf: true,
    },
  });

  return { child, adult, resort };
}

async function main() {
  await cleanup();
  const { child, adult, resort } = await setup();
  // Fixed "now" well before the lesson so lead time never interferes.
  const now = new Date("2026-01-01T12:00:00Z");

  console.log("\nbooking creation");

  const first = await createBooking({
    coachId: COACH,
    dateKey: DAY,
    startHour: 9,
    hours: 2,
    lessonType: "riding",
    locale: "zh",
    account: {
      id: ADULT,
      participantId: adult.id,
      participantName: "张伟",
      participantIsMinor: adult.isMinor,
    },
    now,
  });
  check("9-11 for an adult is accepted", first.ok);

  const priced = first.ok
    ? await prisma.booking.findUnique({ where: { code: first.code } })
    : null;
  check(
    "a ski lesson booked in January is $70x2 less ten minutes' fee ($11.67) = $128.33",
    priced?.totalCents === 12833 &&
      priced?.handoverDiscountCents === 1167 &&
      priced?.subtotalCents === 14000 &&
      priced?.lessonType === "riding" &&
      priced?.earlyBird === false,
    `total=${priced?.totalCents}`,
  );
  check(
    "lesson window is 9:10-11:00",
    priced?.lessonStartAt.toISOString() === "2026-01-08T14:10:00.000Z" &&
      priced?.lessonEndAt.toISOString() === "2026-01-08T16:00:00.000Z",
  );
  check("self-serve booking starts on HOLD with a timer", priced?.status === "HOLD" && priced?.holdExpiresAt !== null);
  check("disclosure snapshot is frozen onto the booking", priced?.disclosureSnapshot !== null);

  const overlap = await createBooking({
    coachId: COACH,
    dateKey: DAY,
    startHour: 10,
    hours: 2,
    lessonType: "riding",
    locale: "zh",
    account: {
      id: PARENT,
      participantId: child.id,
      participantName: "小明",
      participantIsMinor: child.isMinor,
    },
    now,
  });
  check(
    "an overlapping booking is refused",
    !overlap.ok && (overlap.reason === "slot-unavailable" || overlap.reason === "slot-taken"),
    overlap.ok ? "accepted!" : overlap.reason,
  );

  const lunch = await createBooking({
    coachId: COACH,
    dateKey: DAY,
    startHour: 12,
    hours: 2,
    lessonType: "riding",
    locale: "zh",
    account: {
      id: PARENT,
      participantId: child.id,
      participantName: "小明",
      participantIsMinor: child.isMinor,
    },
    now,
  });
  check(
    "12:00 is refused because 12-14 would run through lunch",
    !lunch.ok,
    lunch.ok ? "accepted!" : lunch.reason,
  );

  const offSeason = await createBooking({
    coachId: COACH,
    dateKey: "2026-07-21",
    startHour: 9,
    hours: 2,
    lessonType: "riding",
    locale: "zh",
    account: {
      id: ADULT,
      participantId: adult.id,
      participantName: "张伟",
      participantIsMinor: adult.isMinor,
    },
    now,
  });
  check("an out-of-season date is refused", !offSeason.ok && offSeason.reason === "off-season");

  console.log("\ngroup lesson safety gate");
  const group = await createBooking({
    coachId: COACH,
    dateKey: DAY,
    startHour: 14,
    hours: 2,
    lessonType: "riding",
    headcount: 3, // 1-on-3
    locale: "zh",
    account: {
      id: ADULT,
      participantId: adult.id,
      participantName: "张伟",
      participantIsMinor: adult.isMinor,
    },
    now,
  });
  check(
    "multi-person booking is refused until every attendee can carry a waiver",
    !group.ok && group.reason === "group-booking-unavailable",
  );

  console.log("\nwaiver signing (adult)");

  const bookingRow = await prisma.booking.findUnique({
    where: { code: first.ok ? first.code : "" },
    include: bookingInclude,
  });
  // This script uses a historical fixed clock for deterministic slot checks,
  // while signWaiver correctly uses the real server clock. Keep the fixture's
  // hold active so this section tests signing rather than expiry.
  const activeFixtureDeadline = new Date("2099-01-01T00:00:00.000Z");
  await prisma.booking.update({
    where: { id: bookingRow!.id },
    data: { holdExpiresAt: activeFixtureDeadline },
  });
  bookingRow!.holdExpiresAt = activeFixtureDeadline;

  const signed = await signWaiver({
    booking: bookingRow!,
    participantId: adult.id,
    participantName: "张伟",
    participantIsMinor: adult.isMinor,
    signerUserId: ADULT,
    signerName: "张伟",
    signerEmail: "__flow_adult@example.invalid",
    typedName: "张伟",
    signatureImage: SIG,
    consentToElectronic: true,
    agreedCheckboxes: Object.fromEntries(
      acknowledgementIds("adult").map((id) => [id, true]),
    ) as Record<string, true>,
    guardianName: null,
    guardianPhone: null,
    guardianRelationship: null,
    ipAddress: "203.0.113.9",
    userAgent: "flow-check",
  });
  check("adult waiver is accepted", signed.ok, signed.ok ? "" : signed.reason);

  const afterSign = await prisma.booking.findUnique({
    where: { id: bookingRow!.id },
    include: { waiver: true },
  });
  check("booking advances to AWAITING_PAYMENT", afterSign?.status === "AWAITING_PAYMENT");
  check("waiver is recorded against the participant", afterSign?.waiver?.participantId === adult.id);
  check("signer role is PARTICIPANT for an adult", afterSign?.waiver?.signerRole === "PARTICIPANT");
  check("season is 2025-26", afterSign?.waiver?.season === "2025-26");

  if (afterSign?.waiver) {
    const pdf = await readObject(afterSign.waiver.signedPdfKey);
    check("signed PDF was written to private storage", pdf.length > 10_000, `${(pdf.length / 1024).toFixed(0)} KB`);
    check("PDF starts with a PDF header", pdf.subarray(0, 5).toString() === "%PDF-");
    check("PDF hash is recorded", (afterSign.waiver.signedPdfSha256 ?? "").length === 64);
  }

  console.log("\nmissing acknowledgement is refused");
  const partial = await signWaiver({
    booking: bookingRow!,
    participantId: adult.id,
    participantName: "张伟",
    participantIsMinor: adult.isMinor,
    signerUserId: ADULT,
    signerName: "张伟",
    signerEmail: "__flow_adult@example.invalid",
    typedName: "张伟",
    signatureImage: SIG,
    consentToElectronic: true,
    // Every required tick except the last one.
    agreedCheckboxes: Object.fromEntries(
      acknowledgementIds("adult").slice(0, -1).map((id) => [id, true]),
    ) as Record<string, true>,
    guardianName: null,
    guardianPhone: null,
    guardianRelationship: null,
    ipAddress: "203.0.113.9",
    userAgent: "flow-check",
  });
  check(
    "signing without every required tick is refused",
    !partial.ok && partial.reason === "missing-acknowledgement",
  );

  console.log("\nwaiver reuse within the season");

  const second = await createBooking({
    coachId: COACH,
    dateKey: DAY,
    startHour: 14,
    hours: 2,
    lessonType: "riding",
    locale: "zh",
    account: {
      id: ADULT,
      participantId: adult.id,
      participantName: "张伟",
      participantIsMinor: adult.isMinor,
    },
    now,
  });
  check("a second booking with the same coach is accepted", second.ok);

  const adultWaivers = await prisma.waiver.findMany({
    where: { participantId: adult.id, coachId: COACH },
  });
  const reuse = resolveWaiver({
    waivers: adultWaivers,
    participantIsMinor: adult.isMinor,
    lessonStartAt: torontoWallTimeToUtc(DAY, 14),
  });
  const secondRow = second.ok
    ? await prisma.booking.findUnique({ where: { code: second.code } })
    : null;
  check(
    "createBooking reuses the existing signature and goes straight to payment",
    second.ok &&
      second.nextStep === "payment" &&
      secondRow?.status === "AWAITING_PAYMENT" &&
      secondRow.waiverId === afterSign?.waiverId,
  );
  check("the pure resolver agrees that no re-signing is needed", !reuse.needsSigning);

  const sweptAfterWaiver = await sweepExpiredHolds(
    prisma,
    COACH,
    new Date("2026-01-01T12:31:00.000Z"),
  );
  const expiredSecond = second.ok
    ? await prisma.booking.findUnique({ where: { code: second.code } })
    : null;
  check(
    "the original hold still expires while awaiting payment",
    sweptAfterWaiver === 1 && expiredSecond?.status === "EXPIRED",
  );

  const nextSeason = resolveWaiver({
    waivers: adultWaivers,
    participantIsMinor: adult.isMinor,
    lessonStartAt: torontoWallTimeToUtc("2026-12-10", 9),
  });
  check("next season needs a fresh signature", nextSeason.needsSigning);

  console.log("\nguardian signing and cross-use");

  const childBooking = await createBooking({
    coachId: COACH,
    dateKey: DAY,
    startHour: 11,
    hours: 2,
    lessonType: "riding",
    locale: "zh",
    account: {
      id: PARENT,
      participantId: child.id,
      participantName: "小明",
      participantIsMinor: child.isMinor,
    },
    now,
  });
  check("a booking for the child is accepted", childBooking.ok);

  const childRow = await prisma.booking.findUnique({
    where: { code: childBooking.ok ? childBooking.code : "" },
    include: bookingInclude,
  });
  await prisma.booking.update({
    where: { id: childRow!.id },
    data: { holdExpiresAt: activeFixtureDeadline },
  });
  childRow!.holdExpiresAt = activeFixtureDeadline;

  const guardianSigned = await signWaiver({
    booking: childRow!,
    participantId: child.id,
    participantName: "小明",
    participantIsMinor: child.isMinor,
    signerUserId: PARENT,
    signerName: "张丽",
    signerEmail: "__flow_parent@example.invalid",
    typedName: "张丽",
    signatureImage: SIG,
    consentToElectronic: true,
    agreedCheckboxes: Object.fromEntries(
      acknowledgementIds("guardian").map((id) => [id, true]),
    ) as Record<string, true>,
    guardianName: "张丽",
    guardianPhone: "+1 416 555 0134",
    guardianRelationship: "Mother",
    ipAddress: "203.0.113.10",
    userAgent: "flow-check",
  });
  check("guardian waiver is accepted", guardianSigned.ok, guardianSigned.ok ? "" : guardianSigned.reason);

  const childWaivers = await prisma.waiver.findMany({
    where: { participantId: child.id, coachId: COACH },
  });
  check("guardian signature is flagged as such", childWaivers[0]?.signerRole === "GUARDIAN");
  check("participantWasMinor is recorded", childWaivers[0]?.participantWasMinor === true);

  // The point of keying waivers to participants rather than accounts.
  const parentSelfWaivers = await prisma.waiver.findMany({
    where: { coachId: COACH, participant: { accountId: PARENT, isSelf: true } },
  });
  check(
    "the child's waiver does not count as one for the parent",
    parentSelfWaivers.length === 0,
  );
  check(
    "the adult's waiver does not count for the child",
    !childWaivers.some((w) => w.participantId === adult.id),
  );

  console.log("\ndeposit payments");
  const depositBooking = await createBooking({
    coachId: COACH,
    dateKey: DAY2,
    startHour: 14,
    hours: 2,
    lessonType: "riding",
    paymentPlan: "DEPOSIT",
    requestedSkills: ["carving", "short_turn", "not_a_real_skill"],
    locale: "zh",
    account: {
      id: ADULT,
      participantId: adult.id,
      participantName: "张伟",
      participantIsMinor: adult.isMinor,
      level: "intermediate",
    },
    now,
  });
  check(
    "a deposit booking is accepted",
    depositBooking.ok,
    depositBooking.ok ? "" : depositBooking.reason,
  );

  const depositRow = depositBooking.ok
    ? await prisma.booking.findUnique({ where: { code: depositBooking.code } })
    : null;

  check(
    "the deposit is one hour at the booked rate",
    depositRow?.depositCents === 7000,
    `deposit=${depositRow?.depositCents} total=${depositRow?.totalCents}`,
  );
  check(
    "unknown skill keys are dropped, real ones kept",
    depositRow?.requestedSkills.length === 2 &&
      depositRow.requestedSkills.includes("carving") &&
      !depositRow.requestedSkills.includes("not_a_real_skill"),
    (depositRow?.requestedSkills ?? []).join(","),
  );
  check(
    "the student's ability is snapshotted onto the booking",
    depositRow?.studentLevel === "intermediate",
  );

  if (depositRow) {
    check(
      "before anything clears, the deposit is what is due",
      stageOf(depositRow) === "DEPOSIT" && amountDueCents(depositRow) === 7000,
    );

    // What the review route does when the coach confirms the first screenshot.
    const afterDeposit = await prisma.booking.update({
      where: { id: depositRow.id },
      data: { status: "CONFIRMED", amountPaidCents: depositRow.depositCents },
    });
    check(
      "once the deposit clears the booking is confirmed with a balance owing",
      afterDeposit.status === "CONFIRMED" && balanceCents(afterDeposit) === 5833,
      `owing=${balanceCents(afterDeposit)}`,
    );
    check(
      "the next payment asked for is the balance, not the deposit again",
      stageOf(afterDeposit) === "BALANCE" &&
        amountDueCents(afterDeposit) === 5833,
    );

    // What the balance route does when the coach records the rest.
    const settled = await prisma.booking.update({
      where: { id: depositRow.id },
      data: {
        amountPaidCents: afterDeposit.totalCents,
        balanceSettledAt: new Date(),
      },
    });
    check("settling the balance clears it", balanceCents(settled) === 0);

    console.log("\ncoach cancellation");
    const cancelled = await prisma.booking.update({
      where: { id: depositRow.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledById: COACH,
        cancelReason: "雪场关闭",
      },
    });
    check(
      "a cancelled booking keeps its record",
      cancelled.cancelReason === "雪场关闭" && cancelled.cancelledById === COACH,
    );
    check(
      "a cancelled booking no longer occupies the slot",
      !OCCUPYING_STATUSES.includes(cancelled.status),
    );

    // The proof that matters: the same hour can be booked again.
    const rebooked = await createBooking({
      coachId: COACH,
      dateKey: DAY2,
      startHour: 14,
      hours: 2,
      lessonType: "riding",
      locale: "zh",
      account: {
        id: ADULT,
        participantId: adult.id,
        participantName: "张伟",
        participantIsMinor: adult.isMinor,
      },
      now,
    });
    check("the freed hour can be booked again", rebooked.ok);
    if (rebooked.ok) {
      await prisma.booking.delete({ where: { code: rebooked.code } });
    }
  }

  const adultAccount = {
    id: ADULT,
    participantId: adult.id,
    participantName: "张伟",
    participantIsMinor: adult.isMinor,
  };

  console.log("\nlesson types and early bird");
  // Booked on 20 November, before the 2025-26 early bird closes on 1 December.
  const early = await createBooking({
    coachId: COACH,
    dateKey: DAY2,
    startHour: 9,
    hours: 2,
    lessonType: "park",
    locale: "zh",
    account: adultAccount,
    now: new Date("2025-11-20T15:00:00Z"),
  });
  const earlyRow = early.ok
    ? await prisma.booking.findUnique({ where: { code: early.code } })
    : null;
  check(
    "a park lesson booked before 1 December is $80x2 less ten minutes' fee ($13.33) = $146.67",
    earlyRow?.lessonType === "park" &&
      earlyRow.earlyBird &&
      earlyRow.hourlyRateCents === 8000 &&
      earlyRow.totalCents === 14667,
    `rate=${earlyRow?.hourlyRateCents} total=${earlyRow?.totalCents}`,
  );
  if (early.ok) await prisma.booking.delete({ where: { code: early.code } });

  const regular = await createBooking({
    coachId: COACH,
    dateKey: DAY2,
    startHour: 9,
    hours: 2,
    lessonType: "csia1_prep",
    locale: "zh",
    account: adultAccount,
    now,
  });
  const regularRow = regular.ok
    ? await prisma.booking.findUnique({ where: { code: regular.code } })
    : null;
  check(
    "Level 1 prep booked in January is the regular $80/h",
    regularRow?.earlyBird === false && regularRow.hourlyRateCents === 8000,
    `rate=${regularRow?.hourlyRateCents}`,
  );
  if (regular.ok) await prisma.booking.delete({ where: { code: regular.code } });

  const noPark = await createBooking({
    coachId: COACH2,
    dateKey: DAY2,
    startHour: 9,
    hours: 2,
    lessonType: "park",
    locale: "zh",
    account: adultAccount,
    now,
  });
  check(
    "a coach with no park rate cannot be booked for park",
    !noPark.ok && noPark.reason === "lesson-type-unavailable",
  );

  console.log("\nlesson packages");
  // Four hours for $180, bought from Alisa and already confirmed by her.
  const pkg = await prisma.lessonPackage.create({
    data: {
      code: "PKG-FLOW01",
      accountId: ADULT,
      offerKey: "blue-mountain-4h",
      resortId: resort.id,
      lessonType: "riding",
      season: "2025-26",
      hours: 4,
      priceCents: 18000,
      payeeCoachId: COACH2,
      status: "ACTIVE",
    },
  });
  const packageBooking = (
    coachId: string,
    dateKey: string,
    startHour: number,
    lessonType = "riding",
  ) =>
    createBooking({
      coachId,
      dateKey,
      startHour,
      hours: 2,
      lessonType,
      paymentPlan: "PACKAGE",
      packageId: pkg.id,
      locale: "zh",
      account: adultAccount,
      now,
    });
  const packageUsage = async () =>
    hoursUsed(
      await prisma.booking.findMany({
        where: { packageId: pkg.id },
        select: { hours: true, status: true, holdExpiresAt: true },
      }),
      now,
    );

  const withKevin = await packageBooking(COACH, DAY, 14);
  check(
    "a package bought from Alisa can be spent with Kevin too",
    withKevin.ok,
    withKevin.ok ? "" : withKevin.reason,
  );
  if (withKevin.ok) {
    await prisma.booking.update({
      where: { code: withKevin.code },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: "改期" },
    });
  }
  check("cancelling that lesson gives the hours back", (await packageUsage()) === 0);

  const first2 = await packageBooking(COACH2, DAY, 9);
  const firstRow = first2.ok
    ? await prisma.booking.findUnique({ where: { code: first2.code }, include: bookingInclude })
    : null;
  check(
    "and with Alisa, who sold it",
    first2.ok && firstRow?.packageId === pkg.id && firstRow.paymentPlan === "PACKAGE",
    first2.ok ? "" : first2.reason,
  );
  check(
    "nothing is owed on a package booking; an hour is valued at $45",
    firstRow?.totalCents === 0 &&
      firstRow.depositCents === 0 &&
      firstRow.handoverDiscountCents === 0 &&
      firstRow.hourlyRateCents === 4500,
  );
  check(
    "without a waiver for Alisa it still starts on HOLD",
    first2.ok && first2.nextStep === "waiver" && firstRow?.status === "HOLD",
  );

  if (firstRow) {
    await prisma.booking.update({
      where: { id: firstRow.id },
      data: { holdExpiresAt: activeFixtureDeadline },
    });
    firstRow.holdExpiresAt = activeFixtureDeadline;
    const alisaSigned = await signWaiver({
      booking: firstRow,
      participantId: adult.id,
      participantName: "张伟",
      participantIsMinor: adult.isMinor,
      signerUserId: ADULT,
      signerName: "张伟",
      signerEmail: "__flow_adult@example.invalid",
      typedName: "张伟",
      signatureImage: SIG,
      consentToElectronic: true,
      agreedCheckboxes: Object.fromEntries(
        acknowledgementIds("adult").map((id) => [id, true]),
      ) as Record<string, true>,
      guardianName: null,
      guardianPhone: null,
      guardianRelationship: null,
      ipAddress: "203.0.113.9",
      userAgent: "flow-check",
    });
    const after = await prisma.booking.findUnique({ where: { id: firstRow.id } });
    check(
      "signing the waiver confirms a package booking outright",
      alisaSigned.ok && after?.status === "CONFIRMED",
      alisaSigned.ok ? `status=${after?.status}` : alisaSigned.reason,
    );
  }

  const second2 = await packageBooking(COACH2, DAY2, 9);
  const secondRow2 = second2.ok
    ? await prisma.booking.findUnique({ where: { code: second2.code } })
    : null;
  check(
    "with a waiver already on file it is confirmed at once",
    second2.ok && second2.nextStep === "done" && secondRow2?.status === "CONFIRMED",
    second2.ok ? `status=${secondRow2?.status}` : second2.reason,
  );
  check("all four hours are now spent", (await packageUsage()) === 4);

  const tooMany = await packageBooking(COACH2, DAY2, 11);
  check(
    "a fifth hour is refused",
    !tooMany.ok && tooMany.reason === "package-insufficient-hours",
  );
  const prepFromPackage = await packageBooking(COACH2, DAY2, 11, "csia1_prep");
  check(
    "a ski-lesson package cannot pay for Level 1 prep",
    !prepFromPackage.ok && prepFromPackage.reason === "package-wrong-lesson-type",
  );
  const notMine = await createBooking({
    coachId: COACH2,
    dateKey: DAY2,
    startHour: 11,
    hours: 2,
    lessonType: "riding",
    paymentPlan: "PACKAGE",
    packageId: pkg.id,
    locale: "zh",
    account: {
      id: PARENT,
      participantId: child.id,
      participantName: "小明",
      participantIsMinor: child.isMinor,
    },
    now,
  });
  check(
    "someone else's package cannot be spent",
    !notMine.ok && notMine.reason === "package-not-found",
  );

  // What the adjust route records when Alisa gives two hours back.
  await prisma.packageAdjustment.create({
    data: { packageId: pkg.id, hours: 2, reason: "补课", createdById: COACH2 },
  });
  const afterAdjust = await packageBooking(COACH2, DAY2, 11);
  check(
    "hours the coach adds can be booked",
    afterAdjust.ok && (await packageUsage()) === 6,
    afterAdjust.ok ? "" : afterAdjust.reason,
  );

  if (secondRow2) {
    await prisma.booking.update({
      where: { id: secondRow2.id },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: "改期" },
    });
  }
  check("cancelling a package lesson gives its hours back", (await packageUsage()) === 4);

  // Deterministic proof of the row lock: hold it in another transaction,
  // cancel the package there, and have a booking arrive meanwhile. It must
  // wait for the lock and then see the cancellation. Without FOR UPDATE it
  // would read the package as still ACTIVE and spend its hours.
  const [, blocked] = await Promise.all([
    prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "LessonPackage" WHERE "id" = ${pkg.id} FOR UPDATE`;
      await new Promise((resolve) => setTimeout(resolve, 400));
      await tx.lessonPackage.update({
        where: { id: pkg.id },
        data: { status: "CANCELLED" },
      });
    }),
    new Promise((resolve) => setTimeout(resolve, 50)).then(() =>
      packageBooking(COACH2, DAY, 11),
    ),
  ]);
  check(
    "a booking waits for the package lock and sees the package cancelled",
    !blocked.ok && blocked.reason === "package-not-active",
    blocked.ok ? "booked!" : blocked.reason,
  );
  await prisma.lessonPackage.update({
    where: { id: pkg.id },
    data: { status: "ACTIVE" },
  });

  // Four bookings racing for the last two hours, each on a different free
  // slot so only the package can stop them.
  const race = await Promise.all([
    packageBooking(COACH2, DAY, 11),
    packageBooking(COACH2, DAY, 14),
    packageBooking(COACH2, DAY2, 9),
    packageBooking(COACH2, DAY2, 14),
  ]);
  const winners = race.filter((r) => r.ok).length;
  const losers = race.filter(
    (r) => !r.ok && r.reason === "package-insufficient-hours",
  ).length;
  check(
    "four bookings racing for the last hours: exactly one wins",
    winners === 1 && losers === race.length - 1,
    `won=${winners} refused=${losers}`,
  );
  check("the package is never overspent", (await packageUsage()) === 6);

  console.log("\naging out of a guardian signature");
  const agedOut = resolveWaiver({
    waivers: childWaivers,
    // Pretend the same person has since turned 18.
    participantIsMinor: false,
    lessonStartAt: torontoWallTimeToUtc("2026-03-15", 9),
  });
  check(
    "once the participant is 18 the guardian waiver stops applying",
    agedOut.needsSigning && agedOut.reason === "aged-out",
  );

  await cleanup();
  console.log(
    failures === 0
      ? "\nAll booking-flow checks passed.\n"
      : `\n${failures} check(s) FAILED.\n`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch(async (err) => {
    console.error(err);
    await cleanup().catch(() => {});
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
