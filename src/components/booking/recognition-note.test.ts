import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ActionRecognition } from "@/lib/freeski/action-recognition";
import { RecognitionNote } from "./recognition-note";

vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: unknown }) => createElement("a", { href, ...props }, children as never) }));

const recognised: ActionRecognition = { status: "recognized", reason: null, action: "short_turn", level: "level3", levelSource: "current_level",
  confidence: .82, alternatives: [{ action: "short_turn", probability: .82 }, { action: "advanced_parallel", probability: .12 }], turns: 6 };
const render = (recognition: ActionRecognition, accountId: string | null = "student", videoId: string | null = "clip") => renderToStaticMarkup(createElement(RecognitionNote,
  { recognition, zh: true, jobId: "job1", actionId: "auto:certification:level2", videoId, tier: "COMPLETE", accountId }));

describe("the recognised action on a report", () => {
  it("names what FreeSki recognised, how sure it was, and offers the next likeliest as corrections", () => {
    const html = render(recognised);
    expect(html).toContain("FreeSki 识别为");
    expect(html).toContain("小回转 · CSIA 3 级");
    expect(html).toContain("把握 82%");
    // The recognised action is not offered as its own correction.
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain("进阶平行弯");
    expect(html).toContain('href="/video-analysis?analyze=clip&amp;replaces=job1#workspace"');
  });

  it("asks for the action when too few turns were filmed, and offers no correction on a lesson or a deleted clip", () => {
    const fallback = render({ ...recognised, status: "fallback", reason: "too_few_turns", action: "demonstration_parallel", confidence: null, alternatives: [] });
    expect(fallback).toContain("完整的弯不到 3 个");
    expect(fallback).toContain("选别的动作");
    for (const html of [render(recognised, null), render(recognised, "student", null)]) {
      expect(html).not.toContain("<button");
      expect(html).not.toContain("选别的动作");
    }
  });
});
