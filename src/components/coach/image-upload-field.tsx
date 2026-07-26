"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Hint, FieldError } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { Loader2, Upload } from "lucide-react";

/**
 * Upload-and-preview for the two images a coach owns: their payment QR codes
 * and their profile photo.
 *
 * Both go through /api/upload, which re-encodes through sharp — that strips
 * EXIF, which on a phone photo can carry GPS. Neither is written under
 * public/, so the preview is fetched back through an authenticated route.
 */
export function ImageUploadField({
  purpose,
  kind,
  previewSrc,
  previewAlt,
  hasImage,
  round,
  hint,
  labels,
  onUploaded,
}: {
  purpose: "payment-qr" | "coach-avatar";
  kind?: string;
  /** Authenticated route the preview is read back from. */
  previewSrc: string;
  previewAlt: string;
  hasImage: boolean;
  /** Circular preview for a face, square for a QR code. */
  round?: boolean;
  hint?: string;
  labels: { upload: string; replace: string; failed: string; tooLarge: string };
  onUploaded: (key: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped after each upload so the <img> refetches rather than showing the
  // cached previous image.
  const [version, setVersion] = useState(0);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.set("file", file);
    body.set("purpose", purpose);
    if (kind) body.set("kind", kind);

    const res = await fetch("/api/upload", { method: "POST", body });
    setBusy(false);

    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error === "too-large" ? labels.tooLarge : labels.failed);
      return;
    }
    const j = (await res.json()) as { key: string };
    onUploaded(j.key);
    setVersion((v) => v + 1);
  }

  const sep = previewSrc.includes("?") ? "&" : "?";

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-4">
        {hasImage && (
          // Streamed from a private authenticated route, so next/image cannot
          // optimise it and would only add an unauthenticated fetch path.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`${previewSrc}${sep}v=${version}`}
            alt={previewAlt}
            className={cn(
              "shrink-0 border border-border",
              round
                ? "size-20 rounded-full object-cover"
                : "size-28 rounded-lg object-contain",
            )}
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
            {hasImage ? labels.replace : labels.upload}
          </Button>
          <Hint>{hint}</Hint>
        </div>
      </div>
      <FieldError>{error}</FieldError>
    </div>
  );
}
