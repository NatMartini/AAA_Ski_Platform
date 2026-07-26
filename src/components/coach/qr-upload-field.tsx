"use client";

import { ImageUploadField } from "./image-upload-field";
import type { Locale } from "@/i18n/routing";

const COPY = {
  zh: {
    upload: "上传二维码",
    replace: "更换二维码",
    failed: "上传失败,请重试。",
    tooLarge: "图片太大,请压缩后再传。",
  },
  en: {
    upload: "Upload QR",
    replace: "Replace QR",
    failed: "Upload failed. Please try again.",
    tooLarge: "That image is too large.",
  },
} as const;

export function QrUploadField({
  kind,
  coachId,
  locale,
  currentKey,
  hint,
  onUploaded,
}: {
  kind: "wechat" | "alipay";
  coachId: string;
  locale: Locale;
  currentKey: string | null;
  hint?: string;
  onUploaded: (key: string) => void;
}) {
  return (
    <ImageUploadField
      purpose="payment-qr"
      kind={kind}
      previewSrc={`/api/files/qr/${coachId}?kind=${kind}`}
      previewAlt={kind === "alipay" ? "Alipay QR" : "WeChat Pay QR"}
      hasImage={Boolean(currentKey)}
      hint={hint}
      labels={COPY[locale]}
      onUploaded={onUploaded}
    />
  );
}
