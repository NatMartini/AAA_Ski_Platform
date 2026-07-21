"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Hint, FieldError } from "@/components/ui/field";
import { Loader2, Upload } from "lucide-react";

export function QrUploadField({
  kind,
  coachId,
  currentKey,
  hint,
  onUploaded,
}: {
  kind: "wechat" | "alipay";
  coachId: string;
  currentKey: string | null;
  hint?: string;
  onUploaded: (key: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped after each upload so the <img> refetches rather than showing the
  // cached previous QR.
  const [version, setVersion] = useState(0);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.set("file", file);
    body.set("purpose", "payment-qr");
    body.set("kind", kind);

    const res = await fetch("/api/upload", { method: "POST", body });
    setBusy(false);

    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "upload-failed");
      return;
    }
    const j = (await res.json()) as { key: string };
    onUploaded(j.key);
    setVersion((v) => v + 1);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-4">
        {currentKey && (
          // Streamed from a private authenticated route, so next/image cannot
          // optimise it and would only add an unauthenticated fetch path.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/files/qr/${coachId}?kind=${kind}&v=${version}`}
            alt={kind === "alipay" ? "Alipay QR" : "WeChat Pay QR"}
            className="size-28 rounded-lg border border-border object-contain"
          />
        )}
        <div className="space-y-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Upload aria-hidden />
            )}
            {currentKey ? "Replace" : "Upload"}
          </Button>
          <Hint>{hint}</Hint>
        </div>
      </div>
      <FieldError>{error}</FieldError>
    </div>
  );
}
