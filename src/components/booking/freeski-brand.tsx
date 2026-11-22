"use client";

import { useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { ShieldCheck } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { DISCLAIMER } from "@/lib/video-analysis/guide-content";

/** FreeSki's mark: a skier crossing its colourful skis. */
export function FreeSkiLogo({ className }: { className?: string }) {
  return <Image src="/freeski/logo-128.png" alt="FreeSki" width={128} height={128} className={cn("size-full object-contain", className)} priority />;
}

/**
 * "FreeSki", linking to FreeSki's own site once it has a domain (NEXT_PUBLIC_FREESKI_SITE_URL); this booking site is to
 * become a subdomain of it.
 */
export function FreeSkiName() {
  const site = process.env.NEXT_PUBLIC_FREESKI_SITE_URL;
  return site ? <a href={site} target="_blank" rel="noopener" className="font-semibold hover:underline">FreeSki</a> : <>FreeSki</>;
}

const SEEN = "freeski-disclaimer-v1";
const subscribeToStorage = (notify: () => void) => { window.addEventListener("storage", notify); return () => window.removeEventListener("storage", notify); };
const readSeen = () => { try { return Boolean(window.localStorage.getItem(SEEN)); } catch { return true; } };

/**
 * The disclaimer on entering video analysis: a line under the title every time, and the first time on a device a
 * notice to acknowledge.
 */
export function AnalysisDisclaimer({ zh, className }: { zh: boolean; className?: string }) {
  // Read from this device's storage; the server never shows the notice, and without storage the line below still says it.
  const seen = useSyncExternalStore(subscribeToStorage, readSeen, () => true);
  const [dismissed, setDismissed] = useState(false);
  const open = !seen && !dismissed;
  const close = () => {
    setDismissed(true);
    try { window.localStorage.setItem(SEEN, new Date().toISOString()); } catch { /* Shown again next time, no harm. */ }
  };
  return <>
    <p className={cn("flex items-start gap-1.5 text-xs leading-relaxed text-ink-3", className)}>
      <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{zh ? DISCLAIMER.zh : DISCLAIMER.en} <Link href="/video-analysis/guide#disclaimer" className="font-semibold text-accent hover:underline">{zh ? "使用指南" : "Guide"}</Link></span>
    </p>
    <Dialog open={open} onClose={close} closeLabel={zh ? "关闭" : "Close"} title={zh ? "使用前请先看" : "Before you start"}>
      <div className="flex items-start gap-3">
        <span className="size-12 shrink-0"><FreeSkiLogo /></span>
        <p className="text-sm leading-relaxed text-ink">{zh ? DISCLAIMER.zh : DISCLAIMER.en}</p>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" asChild><Link href="/video-analysis/guide" onClick={close}>{zh ? "看使用指南" : "Read the guide"}</Link></Button>
        <Button onClick={close}>{zh ? "我知道了" : "Got it"}</Button>
      </div>
    </Dialog>
  </>;
}
