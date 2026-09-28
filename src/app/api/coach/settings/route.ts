import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCoach } from "@/lib/auth/require-user";
import { coachSettingsSchema, fieldErrors } from "@/lib/validators";
import { rateLimitOrRespond } from "@/lib/rate-limit";
import { sanitizeLevelKeys, sanitizeSkillKeys } from "@/lib/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request) {
  const limited = rateLimitOrRespond(req, "write", "coach-settings");
  if (limited) return limited;

  const r = await requireCoach();
  if (!r.ok) return r.response;

  const parsed = coachSettingsSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }
  const d = parsed.data;

  // A coach may only ever edit their own profile; the id is taken from the
  // session, never from the request body.
  const profile = await prisma.coachProfile.findUnique({
    where: { userId: r.user.id },
    select: { id: true },
  });
  if (!profile) {
    return NextResponse.json({ error: "no-profile" }, { status: 404 });
  }

  // The rate card is replaced wholesale: a type left out is a type no longer
  // offered. Existing bookings are unaffected — each froze its own price.
  const updateProfile = prisma.coachProfile.update({
    where: { id: profile.id },
    data: {
      displayName: d.displayName,
      bioZh: emptyToNull(d.bioZh),
      bioEn: emptyToNull(d.bioEn),
      csiaLevel: d.csiaLevel,
      csiaParkLevel: d.csiaParkLevel,
      teachableSkills: sanitizeSkillKeys(d.teachableSkills),
      teachableLevels: sanitizeLevelKeys(d.teachableLevels),
      handoverDiscountCents: d.handoverDiscountCents,
      extraPersonCents: d.extraPersonCents,
      maxGroupSize: d.maxGroupSize,
      minHours: d.minHours,
      maxHours: d.maxHours,
      leadTimeHours: d.leadTimeHours,
      emtEnabled: d.emtEnabled,
      emtEmail: emptyToNull(d.emtEmail),
      emtName: emptyToNull(d.emtName),
      wechatPayEnabled: d.wechatPayEnabled,
      alipayEnabled: d.alipayEnabled,
      wechatId: emptyToNull(d.wechatId),
      contactEmail: emptyToNull(d.contactEmail),
      contactPhone: emptyToNull(d.contactPhone),
      cancellationPolicyZh: d.cancellationPolicyZh,
      cancellationPolicyEn: d.cancellationPolicyEn,
      isPublished: d.isPublished,
    },
  });

  await prisma.$transaction([
    updateProfile,
    prisma.coachRate.deleteMany({
      where: {
        profileId: profile.id,
        lessonType: { notIn: d.rates.map((r) => r.lessonType) },
      },
    }),
    ...d.rates.map((r) =>
      prisma.coachRate.upsert({
        where: {
          profileId_lessonType: {
            profileId: profile.id,
            lessonType: r.lessonType,
          },
        },
        update: {
          regularCents: r.regularCents,
          earlyBirdCents: r.earlyBirdCents,
        },
        create: {
          profileId: profile.id,
          lessonType: r.lessonType,
          regularCents: r.regularCents,
          earlyBirdCents: r.earlyBirdCents,
        },
      }),
    ),
  ]);

  return NextResponse.json({ ok: true });
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
