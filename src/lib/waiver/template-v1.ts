import { createHash } from "node:crypto";

/**
 * ⚠ DRAFT — NOT LEGAL ADVICE, NOT YET REVIEWED BY A LAWYER.
 *
 * This wording must be reviewed by a lawyer licensed in Ontario before the
 * site takes real bookings. It is written to reflect the design constraints
 * below, but drafting an enforceable release is not something to do from first
 * principles.
 *
 * Design constraints this text is built around:
 *
 *  - Ontario's Occupiers' Liability Act s.3(3) permits a release, but the
 *    courts require that the exclusion be brought to the signer's attention.
 *    That is why the operative clauses are numbered and each is acknowledged
 *    with its own checkbox rather than one blanket "I agree".
 *  - Releases are read contra proferentem, so the risks are enumerated
 *    specifically rather than waved at with "any and all risks".
 *  - A guardian cannot sign away a minor's own right to sue in Ontario. The
 *    guardian version says so plainly instead of implying otherwise — quietly
 *    over-claiming would be both ineffective and misleading.
 *  - Consumer protection rights cannot be contracted out of, so clause 8
 *    preserves them explicitly.
 *
 * Bump TEMPLATE_VERSION when the meaning changes: every existing signature
 * stops counting and everyone re-signs. Bump TEMPLATE_REVISION for typo fixes,
 * which leaves signatures valid.
 */

export const TEMPLATE_VERSION = 1;
export const TEMPLATE_REVISION = 1;

export type WaiverVariant = "adult" | "guardian";

export type Clause = {
  /** Stable id: recorded in the signed record, so never renumber these. */
  id: string;
  headingEn: string;
  headingZh: string;
  bodyEn: string;
  bodyZh: string;
  /** Requires its own checkbox rather than being covered by a general one. */
  acknowledge: boolean;
};

const SHARED_CLAUSES: Clause[] = [
  {
    id: "risks",
    headingEn: "1. The risks of skiing and snowboarding",
    headingZh: "一、滑雪与单板固有风险",
    bodyEn:
      "Skiing and snowboarding are inherently dangerous. Risks include, but are not limited to: falling; collision with other skiers, snowboarders, lift towers, snow-making equipment, trees, rocks, fences or other objects; loss of control; variable and difficult snow and ice conditions; bare patches, moguls, ruts and stumps; changing weather and visibility; equipment failure or improper equipment adjustment; boarding, riding and alighting from lifts; and the negligence of other people on the hill. These risks can cause serious injury, permanent disability or death.",
    bodyZh:
      "滑雪与单板运动本身具有危险性。风险包括但不限于:摔倒;与其他滑雪者、单板者、缆车塔架、造雪设备、树木、岩石、围栏或其他物体碰撞;失控;雪况与冰面变化;裸露地面、雪包、沟槽与树桩;天气与能见度变化;器材故障或调校不当;上下缆车过程;以及他人的疏忽。上述风险可能导致严重受伤、永久伤残或死亡。",
    acknowledge: true,
  },
  {
    id: "assumption",
    headingEn: "2. Voluntary assumption of risk",
    headingZh: "二、自愿承担风险",
    bodyEn:
      "You are taking part voluntarily. You accept the risks described above, including the risk that the instructor may be negligent in the ordinary course of teaching. You confirm you are physically fit to take part and have disclosed any medical condition that could affect your safety.",
    bodyZh:
      "你系自愿参加。你接受上述风险,包括教练在日常教学中可能出现疏忽的风险。你确认自身身体状况适合参加,并已告知任何可能影响安全的健康状况。",
    acknowledge: true,
  },
  {
    id: "instructor-scope",
    headingEn: "3. What the instructor does and does not control",
    headingZh: "三、教练的职责范围",
    bodyEn:
      "The instructor teaches technique and supervises during the lesson only. The instructor does not own or operate the ski resort and does not control the condition of the runs, lifts, snow, weather or the conduct of other people on the hill. Any complaint about the resort itself is between you and the resort.",
    bodyZh:
      "教练仅在课程时间内负责教学与指导。教练并非雪场的所有者或经营者,不控制雪道、缆车、雪况、天气或场内他人的行为。与雪场本身有关的任何问题,由你与雪场之间自行解决。",
    acknowledge: false,
  },
  {
    id: "equipment",
    headingEn: "4. Equipment and helmets",
    headingZh: "四、器材与头盔",
    bodyEn:
      "You are responsible for your own equipment and for having it correctly fitted and adjusted. A helmet is strongly recommended and is required for participants under 18.",
    bodyZh:
      "你需自行负责器材及其正确安装与调校。强烈建议佩戴头盔;未满 18 周岁的学员必须佩戴头盔。",
    acknowledge: false,
  },
  {
    id: "insurance",
    headingEn: "5. Insurance",
    headingZh: "五、保险",
    bodyEn:
      "The instructor does not provide health, accident, disability or equipment insurance for you. You are responsible for your own coverage.",
    bodyZh:
      "教练不为你提供医疗、意外、伤残或器材保险。相关保险由你自行安排。",
    acknowledge: false,
  },
  {
    id: "media",
    headingEn: "6. Photographs and video",
    headingZh: "六、影像资料",
    bodyEn:
      "Video or photographs may be taken during a lesson for coaching feedback. They will not be published or used for promotion without your separate written permission.",
    bodyZh:
      "课程中可能拍摄影像用于教学反馈。未经你另行书面同意,不会公开发布或用于宣传。",
    acknowledge: false,
  },
  {
    id: "law",
    headingEn: "7. Governing law and language",
    headingZh: "七、适用法律与语言",
    bodyEn:
      "This agreement is governed by the laws of the Province of Ontario. The English version governs; the Chinese text is a convenience translation.",
    bodyZh:
      "本协议受安大略省法律管辖。以英文版本为准,中文文本仅为方便阅读的译文。",
    acknowledge: false,
  },
  {
    id: "statutory-rights",
    headingEn: "8. Rights this agreement does not affect",
    headingZh: "八、本协议不影响的权利",
    bodyEn:
      "Nothing in this agreement removes any right you have under consumer protection legislation or any other right that cannot be waived by agreement. Nothing here limits liability for gross negligence or wilful misconduct where the law does not permit it to be limited.",
    bodyZh:
      "本协议不排除你在消费者保护法下享有的任何权利,也不排除法律规定不可通过约定放弃的任何权利。在法律不允许限制的范围内,本协议不限制因重大过失或故意不当行为产生的责任。",
    acknowledge: false,
  },
];

const ADULT_RELEASE: Clause = {
  id: "release-adult",
  headingEn: "9. Release of claims",
  headingZh: "九、放弃索赔",
  bodyEn:
    "In exchange for being allowed to take this lesson, you release the instructor from claims for loss, damage or injury arising out of the lesson, including claims arising from the instructor's ordinary negligence, to the extent permitted by Ontario law. You agree not to bring a claim against the instructor for such loss, damage or injury. This does not apply to gross negligence or wilful misconduct, and does not affect the rights preserved in clause 8.",
  bodyZh:
    "作为参加本课程的对价,在安大略省法律允许的范围内,你放弃就本课程引起的损失、损害或人身伤害向教练提出索赔的权利,包括因教练一般疏忽引起的索赔,并同意不就此提起诉讼。本条不适用于重大过失或故意不当行为,亦不影响第八条所保留的权利。",
  acknowledge: true,
};

const GUARDIAN_RELEASE: Clause = {
  id: "release-guardian",
  headingEn: "9. Guardian's release and indemnity",
  headingZh: "九、监护人放弃索赔与赔偿承诺",
  bodyEn:
    "You confirm you are the parent or legal guardian of the participant named above. In exchange for the participant being allowed to take this lesson, you release the instructor from any claim of your own arising out of the lesson, including claims arising from the instructor's ordinary negligence, to the extent permitted by Ontario law, and you agree to indemnify the instructor against costs arising from a claim you bring. This does not apply to gross negligence or wilful misconduct, and does not affect the rights preserved in clause 8.",
  bodyZh:
    "你确认自己是上述学员的父母或法定监护人。作为学员参加本课程的对价,在安大略省法律允许的范围内,你放弃就本课程引起的、属于你本人的索赔,包括因教练一般疏忽引起的索赔,并同意就你提出的索赔所产生的费用向教练作出赔偿。本条不适用于重大过失或故意不当行为,亦不影响第八条所保留的权利。",
  acknowledge: true,
};

/**
 * Said out loud rather than buried. A guardian signature does not bar the
 * child's own future claim in Ontario, and implying otherwise would be both
 * unenforceable and a misrepresentation.
 */
const MINOR_NOTICE: Clause = {
  id: "minor-notice",
  headingEn: "10. Important notice about the participant's own rights",
  headingZh: "十、关于学员本人权利的重要提示",
  bodyEn:
    "This is drawn to your attention deliberately: under Ontario law a parent or guardian generally CANNOT give up a minor child's own right to bring a claim. Signing this does not prevent the participant from bringing a claim in their own name once they are able to. Clause 9 limits your claims, not theirs.",
  bodyZh:
    "特此提请注意:根据安大略省法律,父母或监护人通常**无法**放弃未成年子女本人的索赔权利。签署本协议并不妨碍该学员日后以本人名义提出索赔。第九条限制的是你本人的索赔,而非学员本人的索赔。",
  acknowledge: true,
};

export function clausesFor(variant: WaiverVariant): Clause[] {
  return variant === "guardian"
    ? [...SHARED_CLAUSES, GUARDIAN_RELEASE, MINOR_NOTICE]
    : [...SHARED_CLAUSES, ADULT_RELEASE];
}

export function acknowledgementIds(variant: WaiverVariant): string[] {
  return clausesFor(variant)
    .filter((clause) => clause.acknowledge)
    .map((clause) => clause.id);
}

export const TITLE = {
  en: "Ski and Snowboard Lesson — Waiver, Release and Assumption of Risk",
  zh: "滑雪 / 单板课程 —— 风险告知、免责与责任放弃协议",
} as const;

export const ELECTRONIC_CONSENT = {
  en: "I agree to sign this agreement electronically, and I understand that my electronic signature has the same effect as a handwritten one.",
  zh: "我同意以电子方式签署本协议,并理解电子签名与手写签名具有同等效力。",
} as const;

export const READ_CONFIRMATION = {
  en: "I have read this entire agreement. I understand that I am giving up legal rights by signing it.",
  zh: "我已完整阅读本协议,并理解签署本协议意味着放弃部分法律权利。",
} as const;

/**
 * Hash of the exact wording presented. Stored with each signature so we can
 * later prove which text was on screen, independent of what the file says now.
 */
export function templateHash(variant: WaiverVariant): string {
  const payload = JSON.stringify({
    version: TEMPLATE_VERSION,
    revision: TEMPLATE_REVISION,
    title: TITLE,
    electronicConsent: ELECTRONIC_CONSENT,
    readConfirmation: READ_CONFIRMATION,
    clauses: clausesFor(variant),
  });
  return createHash("sha256").update(payload).digest("hex");
}
