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
import { createBooking } from "../src/lib/booking/create";
import { signWaiver } from "../src/lib/waiver/sign";
import { resolveWaiver } from "../src/lib/waiver/validity";
import { acknowledgementIds } from "../src/lib/waiver/template-v1";
import { identityKey } from "../src/lib/participants";
import { dateKeyToDbDate, torontoWallTimeToUtc } from "../src/lib/time";
import { readObject } from "../src/lib/storage";

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

  await prisma.coachDay.create({
    data: {
      coachId: COACH,
      resortId: resort.id,
      date: dateKeyToDbDate(DAY),
      startHour: 9,
      endHour: 16,
      breakStartHour: 13,
      breakEndHour: 14,
    },
  });

  const child = await prisma.participant.create({
    data: {
      accountId: PARENT,
      fullName: "小明",
      birthDate: dateKeyToDbDate("2015-03-02"),
      identityKey: identityKey("小明", "2015-03-02"),
      isSelf: false,
    },
  });
  const adult = await prisma.participant.create({
    data: {
      accountId: ADULT,
      fullName: "张伟",
      birthDate: dateKeyToDbDate("1990-01-01"),
      identityKey: identityKey("张伟", "1990-01-01"),
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
    account: { id: ADULT, participantId: adult.id, participantName: "张伟" },
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
    account: { id: PARENT, participantId: child.id, participantName: "小明" },
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
    account: { id: PARENT, participantId: child.id, participantName: "小明" },
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
    account: { id: ADULT, participantId: adult.id, participantName: "张伟" },
    now,
  });
  check("an out-of-season date is refused", !offSeason.ok && offSeason.reason === "off-season");

  console.log("\ngroup lesson pricing");
  const group = await createBooking({
    coachId: COACH,
    dateKey: DAY,
    startHour: 14,
    hours: 2,
    headcount: 3, // 1-on-3
    locale: "zh",
    account: { id: ADULT, participantId: adult.id, participantName: "张伟" },
    now,
  });
  check("a 1-on-3 group booking is accepted", group.ok);
  const groupRow = group.ok
    ? await prisma.booking.findUnique({ where: { code: group.code } })
    : null;
  // base 8000 + 2 × 3000 = 14000/h; × 2h = 28000; less 1500 = 26500.
  check(
    "1-on-3 for 2h is $140/h × 2 − $15 = $265",
    groupRow?.headcount === 3 &&
      groupRow?.subtotalCents === 28000 &&
      groupRow?.totalCents === 26500,
    `total=${groupRow?.totalCents}`,
  );
  // Release the slot so it does not collide with the reuse test below.
  if (groupRow) {
    await prisma.booking.delete({ where: { id: groupRow.id } });
  }

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

  const signed = await signWaiver({
    booking: bookingRow!,
    participantId: adult.id,
    participantName: "张伟",
    participantBirthDate: adult.birthDate,
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
    participantBirthDate: adult.birthDate,
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
    account: { id: ADULT, participantId: adult.id, participantName: "张伟" },
    now,
  });
  check("a second booking with the same coach is accepted", second.ok);

  const adultWaivers = await prisma.waiver.findMany({
    where: { participantId: adult.id, coachId: COACH },
  });
  const reuse = resolveWaiver({
    waivers: adultWaivers,
    participantBirthDate: adult.birthDate,
    lessonStartAt: torontoWallTimeToUtc(DAY, 14),
  });
  check("the existing signature covers it — no re-signing", !reuse.needsSigning);

  const nextSeason = resolveWaiver({
    waivers: adultWaivers,
    participantBirthDate: adult.birthDate,
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
    account: { id: PARENT, participantId: child.id, participantName: "小明" },
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

  const guardianSigned = await signWaiver({
    booking: childRow!,
    participantId: child.id,
    participantName: "小明",
    participantBirthDate: child.birthDate,
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

  console.log("\naging out of a guardian signature");
  const agedOut = resolveWaiver({
    waivers: childWaivers,
    // Pretend the same signature belongs to someone turning 18 in Feb 2026.
    participantBirthDate: dateKeyToDbDate("2008-02-01"),
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
