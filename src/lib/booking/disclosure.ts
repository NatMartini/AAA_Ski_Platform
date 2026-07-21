import type { Quote } from "../pricing";
import { formatMoneyShort } from "../pricing";
import { formatTorontoDate, formatTorontoTime } from "../time";
import type { Locale } from "@/i18n/routing";

/**
 * Everything shown on the review page, captured verbatim onto the booking.
 *
 * Frozen on purpose: if the coach edits their cancellation policy or rate next
 * week, the terms this student agreed to must not change underneath them. The
 * confirmation email and the booking detail page both render from this
 * snapshot, not from the live profile.
 */
export type DisclosureSnapshot = {
  version: 1;
  capturedAt: string;
  locale: Locale;
  coach: {
    displayName: string;
    contactEmail: string | null;
    contactPhone: string | null;
    wechatId: string | null;
  };
  resort: { nameEn: string; nameZh: string };
  lesson: {
    dateKey: string;
    bookedStartIso: string;
    bookedEndIso: string;
    lessonStartIso: string;
    lessonEndIso: string;
    lessonMinutes: number;
    hours: number;
  };
  price: {
    hourlyRateCents: number;
    subtotalCents: number;
    handoverDiscountCents: number;
    totalCents: number;
    currency: string;
  };
  cancellationPolicy: { zh: string; en: string };
  participantName: string;
};

export function buildDisclosure(input: {
  locale: Locale;
  coach: {
    displayName: string;
    contactEmail: string | null;
    contactPhone: string | null;
    wechatId: string | null;
  };
  resort: { nameEn: string; nameZh: string };
  dateKey: string;
  startAt: Date;
  endAt: Date;
  lessonStartAt: Date;
  lessonEndAt: Date;
  quote: Quote;
  cancellationPolicyZh: string;
  cancellationPolicyEn: string;
  participantName: string;
}): DisclosureSnapshot {
  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    locale: input.locale,
    coach: input.coach,
    resort: input.resort,
    lesson: {
      dateKey: input.dateKey,
      bookedStartIso: input.startAt.toISOString(),
      bookedEndIso: input.endAt.toISOString(),
      lessonStartIso: input.lessonStartAt.toISOString(),
      lessonEndIso: input.lessonEndAt.toISOString(),
      lessonMinutes: input.quote.lessonMinutes,
      hours: input.quote.hours,
    },
    price: {
      hourlyRateCents: input.quote.hourlyRateCents,
      subtotalCents: input.quote.subtotalCents,
      handoverDiscountCents: input.quote.handoverDiscountCents,
      totalCents: input.quote.totalCents,
      currency: input.quote.currency,
    },
    cancellationPolicy: {
      zh: input.cancellationPolicyZh,
      en: input.cancellationPolicyEn,
    },
    participantName: input.participantName,
  };
}

/** Plain-text rendering for the confirmation email. */
export function renderDisclosureText(
  snapshot: DisclosureSnapshot,
  code: string,
  locale: Locale,
): string {
  const zh = locale === "zh";
  const start = new Date(snapshot.lesson.lessonStartIso);
  const end = new Date(snapshot.lesson.lessonEndIso);
  const bookedStart = new Date(snapshot.lesson.bookedStartIso);
  const bookedEnd = new Date(snapshot.lesson.bookedEndIso);
  const p = snapshot.price;

  const lines = [
    zh ? `订单号:${code}` : `Booking reference: ${code}`,
    "",
    zh ? `学员:${snapshot.participantName}` : `Student: ${snapshot.participantName}`,
    zh ? `教练:${snapshot.coach.displayName}` : `Coach: ${snapshot.coach.displayName}`,
    zh
      ? `雪场:${snapshot.resort.nameZh}`
      : `Resort: ${snapshot.resort.nameEn}`,
    zh
      ? `日期:${formatTorontoDate(bookedStart, "zh")}`
      : `Date: ${formatTorontoDate(bookedStart, "en")}`,
    zh
      ? `预定时段:${formatTorontoTime(bookedStart, "zh")} – ${formatTorontoTime(bookedEnd, "zh")}`
      : `Booked block: ${formatTorontoTime(bookedStart, "en")} – ${formatTorontoTime(bookedEnd, "en")}`,
    zh
      ? `实际授课:${formatTorontoTime(start, "zh")} – ${formatTorontoTime(end, "zh")}(${snapshot.lesson.lessonMinutes} 分钟)`
      : `Lesson runs: ${formatTorontoTime(start, "en")} – ${formatTorontoTime(end, "en")} (${snapshot.lesson.lessonMinutes} min)`,
    "",
    zh ? "价格明细" : "Price breakdown",
    `  ${formatMoneyShort(p.hourlyRateCents)} ${zh ? "/ 小时 ×" : "/ hour ×"} ${snapshot.lesson.hours} ${zh ? "小时" : "hours"} = ${formatMoneyShort(p.subtotalCents)}`,
    `  ${zh ? "交接扣减(每单 10 分钟)" : "Handover credit (10 min per booking)"} = -${formatMoneyShort(p.handoverDiscountCents)}`,
    `  ${zh ? "实付" : "Total"} = ${formatMoneyShort(p.totalCents)} ${p.currency}`,
    "",
    zh ? "取消与退款政策" : "Cancellation and refund policy",
    zh ? snapshot.cancellationPolicy.zh : snapshot.cancellationPolicy.en,
    "",
    zh ? "联系方式" : "Contact",
    [
      snapshot.coach.contactEmail,
      snapshot.coach.contactPhone,
      snapshot.coach.wechatId ? `WeChat: ${snapshot.coach.wechatId}` : null,
    ]
      .filter(Boolean)
      .map((v) => `  ${v}`)
      .join("\n"),
  ];

  return lines.join("\n");
}
