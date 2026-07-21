"use client";

import { useState } from "react";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/routing";
import { Check, Copy, Lock } from "lucide-react";

export function IcsFeedBox({
  locale,
  url,
  title,
  help,
}: {
  locale: Locale;
  url: string;
  title: string;
  help: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the input is selectable as a fallback.
    }
  }

  return (
    <Card className="space-y-3">
      <CardTitle>{title}</CardTitle>
      <CardDescription>{help}</CardDescription>

      <div className="flex flex-wrap items-center gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          aria-label={title}
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-surface-muted px-3 font-mono text-xs"
        />
        <Button type="button" variant="secondary" size="sm" onClick={copy}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied
            ? locale === "zh"
              ? "已复制"
              : "Copied"
            : locale === "zh"
              ? "复制"
              : "Copy"}
        </Button>
      </div>

      {/* This URL is the only credential protecting the feed, so say so plainly
          rather than assuming it is obvious. */}
      <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
        <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {locale === "zh"
          ? "此地址等同于密码,任何拿到它的人都能看到你的全部课表。请勿转发或公开。"
          : "Treat this link like a password — anyone who has it can read your whole schedule. Do not share or post it."}
      </p>
    </Card>
  );
}
