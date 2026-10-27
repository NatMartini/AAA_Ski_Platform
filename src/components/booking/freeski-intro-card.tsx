import { ArrowRight, Video } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function FreeSkiIntroCard({ copy }: { copy: {
  title: string; attribution: string; body: string; quotaPolicy: string; sharedPolicy: string; action: string;
} }) {
  return (
    <Card className="space-y-4 border-border-strong text-left">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Video className="size-5" aria-hidden />
        </span>
        <div className="space-y-1">
          <CardTitle className="text-xl">{copy.title}</CardTitle>
          <p className="text-sm font-semibold text-accent">{copy.attribution}</p>
        </div>
      </div>
      <CardDescription>{copy.body}</CardDescription>
      <div className="space-y-1 rounded-xl bg-surface-2 p-3.5 text-sm">
        <p className="font-bold">{copy.quotaPolicy}</p>
        <p className="text-xs leading-relaxed text-ink-2">{copy.sharedPolicy}</p>
      </div>
      <Button asChild><Link href="/video-analysis">{copy.action}<ArrowRight aria-hidden /></Link></Button>
    </Card>
  );
}
