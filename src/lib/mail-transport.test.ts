import { expect, it } from "vitest";
import nodemailer from "nodemailer";

it("preserves the SMTP message contract with the patched Nodemailer major version", async () => {
  // Exercise MIME generation without a network connection or a real recipient.
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  const info = await transport.sendMail({
    from: "AAA Ski <no-reply@example.test>", to: "student@example.test",
    subject: "预约签字 / Sign your waiver", text: "Open https://ski.example.test/zh/w/test-token to sign.",
    html: "<p>请打开预约平台完成签字。</p>",
  });
  expect(info.envelope).toMatchObject({ from: "no-reply@example.test", to: ["student@example.test"] });
  expect(Buffer.isBuffer(info.message)).toBe(true);
  const mime = info.message.toString("utf8");
  expect(mime).toContain("multipart/alternative");
  expect(mime).toContain("text/plain");
  expect(mime).toContain("text/html");
  expect(mime).toContain("https://ski.example.test/zh/w/test-token");
  transport.close();
});
