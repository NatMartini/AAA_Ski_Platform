import type { AnalysisTier } from "./tiers";

/** The disclaimer shown on entering video analysis (owner's wording, 2026-11-09). */
export const DISCLAIMER = {
  zh: "FreeSki 只做技术分析。分析依据 Kevin 作为 CSIA 教练的经验，不代表 CSIA 的官方评价和立场。",
  en: "FreeSki provides technical analysis only. It draws on Kevin's experience as a CSIA instructor and does not represent CSIA's official assessment or position.",
};

/** What a report contains, and from which tier up. */
export const TIER_CONTENTS: { zh: string; en: string; from: AnalysisTier }[] = [
  { zh: "文字结论：主要的动作问题和怎么调整", en: "Written conclusion: the main problem and how to adjust", from: "SIMPLE" },
  { zh: "每个弯的分数和每项测量", en: "Every turn's score and every measurement", from: "STANDARD" },
  { zh: "文字改进方法和 CSIA 练习", en: "Written fixes and CSIA drills", from: "STANDARD" },
  { zh: "为什么会这样：每个问题的文字讲解", en: "Why it happens: each problem explained in words", from: "DEEP" },
  { zh: "逐弯 3D 对比、关键帧和慢动作讲解", en: "Turn-by-turn 3D comparison, key frames and slow-motion explainer", from: "DEEP" },
  { zh: "最深一档的文字讲解", en: "The deepest written explanation", from: "DEEP" },
  { zh: "整段滑行轨迹和雪道宽度", en: "Your whole path and the piste's width", from: "COMPLETE" },
  { zh: "受力图", en: "Force diagrams", from: "COMPLETE" },
  { zh: "3D 动作讲解动画（看问题、为什么、怎么改、对比）", en: "3D animated lessons (the problem, why, the fix, side by side)", from: "COMPLETE" },
];

/** The report's sections in reading order. */
export const REPORT_SECTIONS = [
  { zh: "结论", en: "Summary", textZh: "这次做得好的和最该练的一件事。", textEn: "What went well, and the one thing to work on." },
  { zh: "看问题", en: "Watch", textZh: "逐弯看你和标准动作：视频、3D 人物、骨架，可以转视角、慢放；还有关键帧、慢动作讲解和滑行轨迹。", textEn: "Each turn against the standard: the video, 3D skiers and skeletons you can turn and slow down; key frames, the slow-motion explainer and your path." },
  { zh: "动作讲解", en: "Explained", textZh: "按最需要改的排：视频里看什么、你的数据、为什么（受力）、怎么改、练习。", textEn: "Worst first: what to look for, your measurements, why (the forces), what to do, drills." },
  { zh: "怎么练", en: "Practise", textZh: "按 CSIA 指南挑的练习，写明对哪个弯有用。", textEn: "CSIA guide drills, with the turns they help." },
  { zh: "数据", en: "Data", textZh: "每项测量和标准动作范围的对比。", textEn: "Every measurement against the standard's range." },
];
