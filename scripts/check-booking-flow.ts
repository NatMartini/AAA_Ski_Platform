/**
 * End-to-end exercise of the booking domain against the real database.
 *
 * Covers what unit tests cannot: the create-booking transaction, the waiver
 * signing pipeline (including PDF generation), waiver reuse across bookings,
 * and the guardian/aged-out rules — all against live Postgres.
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

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    /* fine */
  }
}

const prisma = new PrismaClient({ log: ["error"] });

const COACH = "__flow_check_coach";
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
  const users = [COACH, PARENT, ADULT];
  const waiverFiles = await prisma.waiver.findMany({
    where: { coachId: COACH },
    select: { signedPdfKey: true },
  });
  for (const waiver of waiverFiles) {
    await deleteObject(waiver.signedPdfKey).catch(() => undefined);
  }
  await prisma.waiver.deleteMany({ where: { coachId: COACH } });
  await prisma.booking.deleteMany({ where: { coachId: COACH } });
  await prisma.participant.deleteMany({ where: { accountId: { in: users } } });
  await prisma.coachDay.deleteMany({ where: { coachId: COACH } });
  await prisma.coachProfile.deleteMany({ where: { userId: COACH } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.resort.deleteMany({ where: { slug: RESORT_SLUG } });
}

async function setup() {
  await prisma.user.create({
    data: { id: COACH, email: "__flow_coach@example.invalid", name: "Kevin", role: "COACH" },
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

  await prisma.coachProfile.create({
    data: {
      userId: COACH,
      displayName: "Kevin",
      hourlyRateCents: 8000,
      handoverDiscountCents: 1500,
      minHours: 2,
      maxHours: 8,
      leadTimeHours: 0,
      emtEnabled: true,
      emtEmail: "__flow_coach@example.invalid",
      cancellationPolicyEn: "48h full refund.",
      cancellationPolicyZh: "48 小时前全额退款。",
      icsToken: "__flow_check_token",
      isPublished: true,
    },
  });

  for (const day of [DAY, DAY2]) {
    await prisma.coachDay.create({
      data: {
        coachId: COACH,
        resortId: resort.id,
        date: dateKeyToDbDate(day),
        startHour: 9,
        endHour: 16,
        breakStartHour: 13,
        breakEndHour: 14,
      },
    });
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

  return { child, adult };
}

async function main() {
  await cleanup();
  const { child, adult } = await setup();
  // Fixed "now" well before the lesson so lead time never interferes.
  const now = new Date("2026-01-01T12:00:00Z");

  console.log("\nbooking creation");

  const first = await createBooking({
    coachId: COACH,
    dateKey: DAY,
    startHour: 9,
    hours: 2,
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
    "price is $80x2 less $15 = $145",
    priced?.totalCents === 14500 && priced?.subtotalCents === 16000,
    `total=${priced?.totalCents}`,
  );
  check(
    "lesson window is 9:05-10:55",
    priced?.lessonStartAt.toISOString() === "2026-01-08T14:05:00.000Z" &&
      priced?.lessonEndAt.toISOString() === "2026-01-08T15:55:00.000Z",
  );
  check("self-serve booking starts on HOLD with a timer", priced?.status === "HOLD" && priced?.holdExpiresAt !== null);
  check("disclosure snapshot is frozen onto the booking", priced?.disclosureSnapshot !== null);

  const overlap = await createBooking({
    coachId: COACH,
    dateKey: DAY,
    startHour: 10,
    hours: 2,
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
    include: {
      coach: { select: { id: true, name: true, email: true } },
      resort: true,
      coachDay: true,
      participant: true,
      account: { select: { id: true, email: true, name: true } },
      waiver: true,
      waiverInvite: true,
    },
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
    include: {
      coach: { select: { id: true, name: true, email: true } },
      resort: true,
      coachDay: true,
      participant: true,
      account: { select: { id: true, email: true, name: true } },
      waiver: true,
      waiverInvite: true,
    },
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
    depositRow?.depositCents === 8000,
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
      stageOf(depositRow) === "DEPOSIT" && amountDueCents(depositRow) === 8000,
    );

    // What the review route does when the coach confirms the first screenshot.
    const afterDeposit = await prisma.booking.update({
      where: { id: depositRow.id },
      data: { status: "CONFIRMED", amountPaidCents: depositRow.depositCents },
    });
    check(
      "once the deposit clears the booking is confirmed with a balance owing",
      afterDeposit.status === "CONFIRMED" && balanceCents(afterDeposit) === 6500,
      `owing=${balanceCents(afterDeposit)}`,
    );
    check(
      "the next payment asked for is the balance, not the deposit again",
      stageOf(afterDeposit) === "BALANCE" &&
        amountDueCents(afterDeposit) === 6500,
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
