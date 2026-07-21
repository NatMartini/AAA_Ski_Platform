/**
 * Proves the `booking_no_overlap` exclusion constraint actually holds.
 *
 * This is the one guarantee that cannot be verified by unit tests — it lives in
 * the database, not in TypeScript. Run it after any migration that touches the
 * Booking table or the BookingStatus enum:
 *
 *   npm run check:overlap
 *
 * Creates and removes its own fixtures under clearly-named test ids.
 */
import { PrismaClient, type BookingStatus } from "@prisma/client";
import { isOverlapViolation } from "../src/lib/booking/overlap";

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // Missing file is fine.
  }
}

const prisma = new PrismaClient({ log: ["error"] });

const COACH_A = "__overlap_check_coach_a";
const COACH_B = "__overlap_check_coach_b";
const RESORT_SLUG = "__overlap_check_resort";
const DAY = new Date(Date.UTC(2026, 0, 8));

/** January in Toronto is UTC-5, so wall-clock hour h is h+5 UTC. */
function utcForHour(hour: number): Date {
  return new Date(Date.UTC(2026, 0, 8, hour + 5));
}

let failures = 0;

async function expect(
  label: string,
  outcome: "accepted" | "rejected",
  fn: () => Promise<unknown>,
): Promise<void> {
  let actual: "accepted" | "rejected";
  try {
    await fn();
    actual = "accepted";
  } catch (err) {
    if (!isOverlapViolation(err)) {
      // Something else broke; that is a failure regardless of what we expected.
      failures++;
      console.log(
        `  ✗ ${label} — errored for the wrong reason: ${
          err instanceof Error ? err.message.split("\n")[0] : String(err)
        }`,
      );
      return;
    }
    actual = "rejected";
  }

  const ok = actual === outcome;
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label} → ${actual} (wanted ${outcome})`);
}

async function setup() {
  await prisma.user.upsert({
    where: { id: COACH_A },
    update: {},
    create: { id: COACH_A, email: "__overlap_a@example.invalid", role: "COACH" },
  });
  await prisma.user.upsert({
    where: { id: COACH_B },
    update: {},
    create: { id: COACH_B, email: "__overlap_b@example.invalid", role: "COACH" },
  });
  const resort = await prisma.resort.upsert({
    where: { slug: RESORT_SLUG },
    update: {},
    create: { slug: RESORT_SLUG, nameEn: "Test", nameZh: "测试" },
  });
  const dayA = await prisma.coachDay.upsert({
    where: { coachId_date: { coachId: COACH_A, date: DAY } },
    update: {},
    create: {
      coachId: COACH_A,
      resortId: resort.id,
      date: DAY,
      startHour: 9,
      endHour: 16,
    },
  });
  const dayB = await prisma.coachDay.upsert({
    where: { coachId_date: { coachId: COACH_B, date: DAY } },
    update: {},
    create: {
      coachId: COACH_B,
      resortId: resort.id,
      date: DAY,
      startHour: 9,
      endHour: 16,
    },
  });
  return { resortId: resort.id, dayA: dayA.id, dayB: dayB.id };
}

function book(
  ctx: { resortId: string; dayA: string; dayB: string },
  opts: {
    code: string;
    from: number;
    to: number;
    coachId?: string;
    status?: BookingStatus;
  },
) {
  const coachId = opts.coachId ?? COACH_A;
  const startAt = utcForHour(opts.from);
  const endAt = utcForHour(opts.to);
  return prisma.booking.create({
    data: {
      code: opts.code,
      coachId,
      resortId: ctx.resortId,
      coachDayId: coachId === COACH_A ? ctx.dayA : ctx.dayB,
      startAt,
      endAt,
      hours: opts.to - opts.from,
      lessonStartAt: new Date(startAt.getTime() + 5 * 60_000),
      lessonEndAt: new Date(endAt.getTime() - 5 * 60_000),
      hourlyRateCents: 8000,
      subtotalCents: (opts.to - opts.from) * 8000,
      handoverDiscountCents: 1500,
      totalCents: (opts.to - opts.from) * 8000 - 1500,
      status: opts.status ?? "HOLD",
    },
  });
}

async function cleanup() {
  await prisma.booking.deleteMany({
    where: { coachId: { in: [COACH_A, COACH_B] } },
  });
  await prisma.coachDay.deleteMany({
    where: { coachId: { in: [COACH_A, COACH_B] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: [COACH_A, COACH_B] } } });
  await prisma.resort.deleteMany({ where: { slug: RESORT_SLUG } });
}

async function main() {
  await cleanup();
  const ctx = await setup();

  console.log("\nbooking_no_overlap constraint");
  console.log("\n  baseline");
  await expect("9-11 on an empty day", "accepted", () =>
    book(ctx, { code: "__ov_a", from: 9, to: 11 }),
  );

  console.log("\n  overlapping the 9-11 booking");
  await expect("10-12 partial overlap", "rejected", () =>
    book(ctx, { code: "__ov_b", from: 10, to: 12 }),
  );
  await expect("9-11 identical block", "rejected", () =>
    book(ctx, { code: "__ov_c", from: 9, to: 11 }),
  );
  await expect("8-12 superset", "rejected", () =>
    book(ctx, { code: "__ov_d", from: 8, to: 12 }),
  );
  await expect("9-10 subset", "rejected", () =>
    book(ctx, { code: "__ov_e", from: 9, to: 10 }),
  );

  console.log("\n  adjacency and released slots");
  await expect("11-13 starts exactly when 9-11 ends", "accepted", () =>
    book(ctx, { code: "__ov_f", from: 11, to: 13 }),
  );
  await expect("9-11 while the original is still HOLD", "rejected", () =>
    book(ctx, { code: "__ov_g", from: 9, to: 11 }),
  );

  await prisma.booking.update({
    where: { code: "__ov_a" },
    data: { status: "CANCELLED" },
  });
  await expect("9-11 once the original is CANCELLED", "accepted", () =>
    book(ctx, { code: "__ov_h", from: 9, to: 11 }),
  );

  await prisma.booking.update({
    where: { code: "__ov_h" },
    data: { status: "EXPIRED" },
  });
  await expect("9-11 once the holder EXPIRED", "accepted", () =>
    book(ctx, { code: "__ov_i", from: 9, to: 11 }),
  );

  console.log("\n  scoping");
  await expect("another coach at the same time", "accepted", () =>
    book(ctx, { code: "__ov_j", from: 9, to: 11, coachId: COACH_B }),
  );

  await cleanup();

  console.log(
    failures === 0
      ? "\nAll constraint checks passed.\n"
      : `\n${failures} constraint check(s) FAILED.\n`,
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
