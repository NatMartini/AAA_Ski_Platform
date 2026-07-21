import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

// Standalone scripts do not get Next's automatic .env.local loading, and the
// Prisma CLI only reads .env — so load it here too, in the same order as
// prisma.config.ts. Real environment variables still win. This must run before
// PrismaClient is constructed, which is why it is not inside main().
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // Missing file is fine.
  }
}

const prisma = new PrismaClient();

/**
 * Seeds the two resorts. Coaches are NOT seeded with fake accounts: a coach
 * account is created the first time that person signs in with Google, and is
 * promoted automatically because their address is in COACH_EMAILS. That keeps
 * the account bound to a real verified mailbox, which is what the waiver
 * signing flow relies on.
 */
async function main() {
  const resorts = [
    {
      slug: "msl",
      nameEn: "Mount St. Louis Moonstone",
      nameZh: "MSL 雪场",
      address: "24 Mount St Louis Rd W, Coldwater, ON",
      order: 0,
    },
    {
      slug: "blue-mountain",
      nameEn: "Blue Mountain",
      nameZh: "蓝山",
      address: "108 Jozo Weider Blvd, The Blue Mountains, ON",
      order: 1,
    },
  ];

  for (const resort of resorts) {
    await prisma.resort.upsert({
      where: { slug: resort.slug },
      update: {
        nameEn: resort.nameEn,
        nameZh: resort.nameZh,
        address: resort.address,
        order: resort.order,
      },
      create: resort,
    });
    console.log(`resort  ${resort.slug.padEnd(16)} ${resort.nameEn}`);
  }

  // Backfill: if a coach row predates the icsToken column having a value.
  const coachesMissingToken = await prisma.coachProfile.findMany({
    where: { icsToken: "" },
    select: { id: true },
  });
  for (const coach of coachesMissingToken) {
    await prisma.coachProfile.update({
      where: { id: coach.id },
      data: { icsToken: randomUUID().replace(/-/g, "") },
    });
  }

  const coachEmails = (process.env.COACH_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (coachEmails.length === 0) {
    console.log("\n⚠ COACH_EMAILS is empty — no one will be promoted to coach.");
  } else {
    console.log(`\ncoach allowlist: ${coachEmails.join(", ")}`);
    console.log("These addresses become coaches on their first Google sign-in.");
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
