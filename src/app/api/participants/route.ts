import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { fieldErrors, participantSchema } from "@/lib/validators";
import { rateLimitOrRespond } from "@/lib/rate-limit";
import { identityKey } from "@/lib/participants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const r = await requireUser();
  if (!r.ok) return r.response;

  const participants = await prisma.participant.findMany({
    where: { accountId: r.user.id, archivedAt: null },
    orderBy: [{ isSelf: "desc" }, { fullName: "asc" }],
  });

  return NextResponse.json({
    participants: participants.map((p) => ({
      id: p.id,
      fullName: p.fullName,
      isMinor: p.isMinor,
      isSelf: p.isSelf,
      skillLevel: p.skillLevel,
      level: p.level,
      phone: p.phone,
      emergencyContactName: p.emergencyContactName,
      emergencyContactPhone: p.emergencyContactPhone,
    })),
  });
}

export async function POST(req: Request) {
  const limited = rateLimitOrRespond(req, "write", "participants");
  if (limited) return limited;

  const r = await requireUser();
  if (!r.ok) return r.response;

  const parsed = participantSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }
  const d = parsed.data;

  // Gate 4: nobody can sign a waiver for another adult, so an adult who is not
  // the account holder cannot be created here at all. They must book with
  // their own account. (Coaches use a different path, where the student signs
  // for themselves via a link.)
  if (!d.isSelf && !d.isMinor) {
    return NextResponse.json({ error: "adult-not-self" }, { status: 400 });
  }

  // Only one "myself" per account.
  if (d.isSelf) {
    const existingSelf = await prisma.participant.findFirst({
      where: { accountId: r.user.id, isSelf: true, archivedAt: null },
      select: { id: true },
    });
    if (existingSelf) {
      return NextResponse.json({ error: "self-exists" }, { status: 409 });
    }
  }

  const key = identityKey(d.fullName);

  try {
    const participant = await prisma.participant.create({
      data: {
        accountId: r.user.id,
        fullName: d.fullName,
        isMinor: d.isMinor,
        identityKey: key,
        isSelf: d.isSelf,
        level: emptyToNull(d.level),
        email: emptyToNull(d.email) ?? (d.isSelf ? r.user.email : null),
        phone: emptyToNull(d.phone),
        wechatId: emptyToNull(d.wechatId),
        skillLevel: d.skillLevel ?? null,
        emergencyContactName: emptyToNull(d.emergencyContactName),
        emergencyContactPhone: emptyToNull(d.emergencyContactPhone),
      },
      select: { id: true },
    });
    return NextResponse.json({ ok: true, id: participant.id }, { status: 201 });
  } catch (err) {
    // Unique on (accountId, identityKey): the same person already exists, which
    // is exactly the duplicate we want to prevent — a second copy would have no
    // waiver attached and could be used to skip signing.
    if ((err as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "duplicate" }, { status: 409 });
    }
    throw err;
  }
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
