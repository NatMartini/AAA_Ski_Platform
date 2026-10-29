import { ArrowRight, Video } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function FreeSkiIntroCard({ copy }: { copy: {
  title: string; attribution: string; body: string; quotaPolicy: string; sharedPolicy: string; action: string;
} }) {
  return (
    <Card className="flex flex-col gap-4 text-left sm:flex-row sm:items-center sm:gap-5">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-cat-video-soft text-cat-video">
        <Video className="size-6" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <CardTitle className="text-lg">{copy.title}</CardTitle>
          <p className="text-sm font-semibold text-cat-video">{copy.attribution}</p>
        </div>
        <CardDescription>{copy.body}</CardDescription>
        <p className="text-xs leading-relaxed text-ink-3">
          <span className="font-semibold text-ink-2">{copy.quotaPolicy}</span> {copy.sharedPolicy}
        </p>
      </div>
      <Button asChild className="shrink-0"><Link href="/video-analysis">{copy.action}<ArrowRight aria-hidden /></Link></Button>
    </Card>
  );
}
