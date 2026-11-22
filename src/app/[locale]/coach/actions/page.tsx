import { setRequestLocale } from "next-intl/server";
import { ListChecks } from "lucide-react";
import { toLocale } from "@/i18n/routing";
import { requireCoachPage } from "@/lib/auth/require-user";
import { getActionUpdateState } from "@/lib/season-update/service";
import { ActionUpdatePanel } from "@/components/coach/action-update-panel";
import { PageHeader } from "@/components/ui/page-header";

/**
 * The season's action list. Once a season the owner downloads the new candidate guides and demonstration videos, edits
 * the list here and presses one button: the demonstrations are analysed and sampled, every action's standard is
 * generated and checked, and the result replaces what the site shows.
 */
export default async function CoachActionsPage({ params }: PageProps<"/[locale]/coach/actions">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireCoachPage({ locale, callbackPath: `/${locale}/coach/actions` });
  const zh = toLocale(locale) === "zh";
  return (
    <div className="space-y-5">
      <PageHeader
        icon={<ListChecks aria-hidden />}
        tone="admin"
        title={zh ? "动作列表" : "Action list"}
        description={zh ? "每个雪季更新一次：把新一季的考官指南和示范视频放好，核对下面的列表，点“更新动作”。"
          : "Updated once a season: put the new candidate guides and demonstration videos in place, check the list below, and press “Update the actions”."}
      />
      <ActionUpdatePanel zh={zh} initial={await getActionUpdateState(user.id)} />
    </div>
  );
}
