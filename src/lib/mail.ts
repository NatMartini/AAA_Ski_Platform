import nodemailer from "nodemailer";

/**
 * Transactional email only: booking confirmations and waiver signing links.
 *
 * There is deliberately no marketing list and no bulk send path. Under CASL,
 * messages about a transaction the recipient is already party to are exempt
 * from the consent requirement; anything promotional would not be, so the
 * simplest way to stay clear is to have no mechanism for it.
 *
 * With SMTP_HOST unset (the dev default) mail is logged to the console instead
 * of sent, so local testing never emails a real student by accident.
 */

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

let transport: nodemailer.Transporter | null = null;

function getTransport(): nodemailer.Transporter | null {
  if (!process.env.SMTP_HOST) return null;
  if (!transport) {
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD,
          }
        : undefined,
    });
  }
  return transport;
}

export type SendResult =
  | { sent: true }
  | { sent: false; reason: "not-configured" | "error"; detail?: string };

export async function sendMail(message: MailMessage): Promise<SendResult> {
  const from = process.env.MAIL_FROM ?? "AAA Ski <no-reply@localhost>";
  const tx = getTransport();

  if (!tx) {
    console.info(
      [
        "",
        "─── email (not sent: SMTP_HOST is unset) ───",
        `To:      ${message.to}`,
        `Subject: ${message.subject}`,
        "",
        message.text,
        "──────────────────────────────────────────",
        "",
      ].join("\n"),
    );
    return { sent: false, reason: "not-configured" };
  }

  try {
    await tx.sendMail({
      from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    return { sent: true };
  } catch (err) {
    // Never let a mail failure roll back a booking that is otherwise valid —
    // the customer can always re-download the confirmation from the site.
    console.error("[mail] send failed", err);
    return {
      sent: false,
      reason: "error",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export function baseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "") ??
    "http://localhost:3000"
  );
}
