import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCoach } from "@/lib/auth/require-user";
import { formatTorontoDateTime, toDateKey } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bookings as CSV, for the coach's own records. */
export async function GET() {
  const r = await requireCoach();
  if (!r.ok) return r.response;

  const bookings = await prisma.booking.findMany({
    where: { coachId: r.user.id },
    include: {
      resort: true,
      participant: true,
      waiver: true,
      package: { select: { code: true } },
    },
    orderBy: { startAt: "desc" },
  });

  const header = [
    "code",
    "date",
    "lesson_start",
    "lesson_end",
    "hours",
    "resort",
    "student",
    "status",
    "lesson_type",
    "early_bird",
    "package",
    "hourly_rate",
    "subtotal",
    "handover_credit",
    "total",
    "currency",
    "payment_method",
    "payment_reference",
    "proof_uploaded_by",
    "waiver_signed_at",
    "waiver_signer_role",
    "created_at",
  ];

  const rows = bookings.map((b) => [
    b.code,
    toDateKey(b.startAt),
    formatTorontoDateTime(b.lessonStartAt, "en"),
    formatTorontoDateTime(b.lessonEndAt, "en"),
    String(b.hours),
    b.resort.nameEn,
    b.participantNameSnapshot ?? b.participant?.fullName ?? b.inviteName ?? "",
    b.status,
    b.lessonType,
    b.earlyBird ? "yes" : "no",
    b.package?.code ?? "",
    money(b.hourlyRateCents),
    money(b.subtotalCents),
    money(b.handoverDiscountCents),
    money(b.totalCents),
    b.currency,
    b.paymentMethod ?? "",
    b.paymentReference ?? "",
    b.proofUploadedBy ?? "",
    b.waiver ? formatTorontoDateTime(b.waiver.signedAt, "en") : "",
    b.waiver?.signerRole ?? "",
    formatTorontoDateTime(b.createdAt, "en"),
  ]);

  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");

  return new NextResponse(
    // Excel needs the BOM to read UTF-8, and student names are often Chinese.
    "﻿" + csv,
    {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="bookings-${toDateKey(new Date())}.csv"`,
        "Cache-Control": "private, no-store",
      },
    },
  );
}

function money(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Quotes a CSV field. The leading apostrophe on formula-looking values stops a
 * spreadsheet executing a pasted name like "=cmd|..." on open.
 */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\r\n]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}
