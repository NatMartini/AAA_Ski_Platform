import { createHash } from "node:crypto";

/**
 * Ski lesson waiver — adapted from the agreement used last season.
 *
 * ⚠ STILL A DRAFT. Have it reviewed by a lawyer licensed in Ontario before
 * taking real bookings. What follows is a faithful port of last season's
 * document into a form this site can present and sign, not new legal drafting.
 *
 * ── Carried over from last season, substantially unchanged ──
 *   The prominent "you are giving up legal rights" warning; the helmet rule;
 *   the Releasees definition; equipment responsibility; the limited-scope and
 *   not-responsible-for lists; the ten sole-responsibility items; the
 *   assumption-of-risks list; the release and indemnity; medical authorisation;
 *   the future-programs clause; Ontario governing law; and the closing
 *   acknowledgements. The thirteen acknowledgement checkboxes match the
 *   thirteen in last season's signature section, clause for clause.
 *
 * ── Deliberately changed, for a lawyer to weigh ──
 *
 *   1. Electronic signature consent (`ELECTRONIC_CONSENT`) is new. Ontario's
 *      Electronic Commerce Act, 2000 s.19(1) wants express consent to the
 *      electronic form. Adobe Sign handled that in its own interface last
 *      season; signing happens on this site now, so it has to be here.
 *
 *   2. `statutory-rights` is new: consumer protection rights cannot be
 *      contracted out of, so the agreement says so rather than appearing to
 *      override them.
 *
 *   3. `minor-notice` is new and appears only on the guardian version. In
 *      Ontario a parent generally cannot waive a minor's own right to sue, and
 *      last season's document did not say so. Stating it plainly costs nothing
 *      that was ever enforceable and avoids the parent being misled about what
 *      they signed. The guardian's own release and indemnity — which is the
 *      part that actually bites — is unchanged.
 *
 *   4. The witness signature line is dropped. Nobody was going to witness a
 *      signature captured on a phone, and an always-blank line is worse than
 *      none. The audit page records the verified Google account, timestamp, IP
 *      and template hash instead.
 *
 *   5. The release is expressed as applying "to the extent permitted by
 *      Ontario law" and carves out gross negligence and wilful misconduct.
 *
 * ── Versioning ──
 * Bump TEMPLATE_VERSION when the meaning changes: every existing signature
 * stops counting and everyone re-signs. Bump TEMPLATE_REVISION for typo fixes,
 * which leaves signatures valid.
 *
 * The English text governs; the Chinese is a convenience translation.
 */

export const TEMPLATE_VERSION = 1;
export const TEMPLATE_REVISION = 1;

export type WaiverVariant = "adult" | "guardian";

export type Clause = {
  /** Stable id, recorded in the signed record. Never renumber these. */
  id: string;
  headingEn: string;
  headingZh: string;
  bodyEn: string;
  bodyZh: string;
  /** Gets its own checkbox rather than being covered by a general one. */
  acknowledge: boolean;
};

/** Shown above the agreement, before anything else. */
export const WARNING = {
  en: "BY SIGNING THIS DOCUMENT YOU WILL WAIVE OR GIVE UP CERTAIN LEGAL RIGHTS, INCLUDING THE RIGHT TO SUE FOR NEGLIGENCE, BREACH OF CONTRACT OR BREACH OF THE OCCUPIERS' LIABILITY ACT, OR TO CLAIM COMPENSATION FOLLOWING AN ACCIDENT. PLEASE READ CAREFULLY BEFORE SIGNING.",
  zh: "签署本文件即表示你将放弃某些法律权利,包括就疏忽、违约或违反《占用者责任法》提起诉讼的权利,以及在事故后索赔的权利。签署前请仔细阅读。",
} as const;

const SHARED_CLAUSES: Clause[] = [
  {
    id: "helmet",
    headingEn: "1. Helmet requirement",
    headingZh: "一、头盔要求",
    bodyEn:
      "HELMETS ARE MANDATORY FOR ALL PARTICIPANTS UNDER 18 YEARS OF AGE, AND ARE STRONGLY RECOMMENDED FOR EVERYONE. I have been advised to wear an approved helmet during the Ski Lesson Activities.",
    bodyZh:
      "未满 18 周岁的学员必须佩戴头盔;强烈建议所有人佩戴头盔。本人已被告知在课程期间应佩戴符合标准的头盔。",
    acknowledge: true,
  },
  {
    id: "releasees",
    headingEn: "2. Activities covered and who is released",
    headingZh: "二、适用范围与免责对象",
    bodyEn:
      "This Release Agreement applies to ski and snowboard instruction, lessons, orientation sessions, guided tours, clinics, competitions and events, and to access to and use of facilities, equipment and designated areas (together, the \"Ski Lesson Activities\").\n\nIt is given to the instructor named on this agreement and to their directors, officers, employees, ski and snowboard instructors, guides, volunteers, agents, independent contractors, subcontractors, representatives, sponsors, successors and assigns (together, the \"Releasees\").",
    bodyZh:
      "本协议适用于滑雪与单板教学、课程、入门指导、带队、训练营、比赛与活动,以及对场地、器材和指定区域的进入与使用(合称「课程活动」)。\n\n本协议的免责对象为本协议列明的教练,及其董事、管理人员、雇员、滑雪与单板教练、领队、志愿者、代理人、独立承包商、分包商、代表、赞助方、继受人与受让人(合称「免责方」)。",
    acknowledge: false,
  },
  {
    id: "equipment",
    headingEn: "3. Equipment responsibility",
    headingZh: "三、器材责任",
    bodyEn:
      "If equipment is rented, I agree to be responsible for it, to pay for any damage to it, and to replace it at full retail value if it is not returned.",
    bodyZh:
      "如租用器材,本人负责保管,并承担任何损坏的赔偿;器材未归还的,按零售全价赔偿。",
    acknowledge: true,
  },
  {
    id: "safety-ack",
    headingEn: "4. Safety acknowledgement",
    headingZh: "四、安全须知确认",
    bodyEn:
      "I am familiar with the proper use of the equipment. I am aware that technicians are available to answer questions about it. I will ski and snowboard safely and within my ability level.",
    bodyZh:
      "本人了解器材的正确使用方法,知悉可向技师咨询相关问题,并将在自身能力范围内安全地滑行。",
    acknowledge: true,
  },
  {
    id: "instructor-scope",
    headingEn: "5. What the instructor does",
    headingZh: "五、教练的职责范围",
    bodyEn:
      "I understand and acknowledge that the instructor's role is LIMITED TO THE FOLLOWING:\n\n1. Observing my skiing or snowboarding technique and form;\n2. Providing technical feedback, instruction and coaching on skiing and snowboarding skills;\n3. Reminding me of general safety practices and ski area rules;\n4. Pointing out potential hazards when observed during instruction;\n5. Offering guidance on appropriate terrain selection based on skill level.",
    bodyZh:
      "本人理解并确认,教练的职责【仅限于】以下事项:\n\n1. 观察本人的滑行技术与动作;\n2. 就滑雪 / 单板技术提供反馈、讲解与指导;\n3. 提醒一般安全注意事项与雪场规定;\n4. 在教学过程中指出所观察到的潜在危险;\n5. 根据水平就选择合适雪道提供建议。",
    acknowledge: true,
  },
  {
    id: "instructor-limits",
    headingEn: "6. What the instructor is not responsible for",
    headingZh: "六、教练不负责的事项",
    bodyEn:
      "THE INSTRUCTOR IS NOT RESPONSIBLE FOR:\n\n1. Ensuring my personal safety at all times, or preventing all accidents;\n2. Supervising my every movement or action;\n3. Controlling weather conditions, terrain features, snow conditions or surface variations;\n4. Monitoring the actions of other skiers, snowboarders or third parties;\n5. Guaranteeing my ability to safely execute any technique or navigate any terrain;\n6. Providing medical care or emergency response services;\n7. Inspecting my personal equipment for safety or proper function.\n\nI acknowledge that observation and safety reminders by the instructor do NOT transfer responsibility for my safety from me to the instructor.",
    bodyZh:
      "教练【不负责】以下事项:\n\n1. 全程确保本人的人身安全,或防止一切事故发生;\n2. 监管本人的每一个动作或行为;\n3. 控制天气、地形、雪况或雪面变化;\n4. 监督其他滑雪者、单板者或第三方的行为;\n5. 保证本人能够安全完成任何技术动作或通过任何地形;\n6. 提供医疗救护或紧急救援服务;\n7. 检查本人个人器材的安全性或功能是否正常。\n\n本人确认:教练的观察与安全提醒【不构成】将本人的安全责任转移给教练。",
    acknowledge: true,
  },
  {
    id: "sole-responsibility",
    headingEn: "7. My sole responsibility for my own safety",
    headingZh: "七、本人对自身安全负全部责任",
    bodyEn:
      "I acknowledge and agree that I AM SOLELY AND ENTIRELY RESPONSIBLE FOR:\n\n1. My own safety during all Ski Lesson Activities — before, during and after instruction;\n2. Skiing or snowboarding within my own ability level and comfort zone;\n3. Following all posted signs, warnings, closures and ski area rules;\n4. Using appropriate equipment that is in good working condition;\n5. Making all decisions about whether to attempt any particular run, terrain feature or manoeuvre;\n6. Stopping or declining any activity if I feel unsafe or uncomfortable;\n7. Seeking medical attention if needed;\n8. Maintaining awareness of my surroundings and of other skiers and snowboarders;\n9. Adapting my skiing or snowboarding to current conditions;\n10. Ensuring I am physically and mentally fit to participate.\n\nI understand that the instructor's guidance does not diminish or transfer my personal responsibility for these matters.",
    bodyZh:
      "本人确认并同意,以下事项【完全由本人负责】:\n\n1. 课程活动前、中、后本人自身的安全;\n2. 在本人能力与舒适范围内滑行;\n3. 遵守所有标识、警示、封闭区域与雪场规定;\n4. 使用状况良好且合适的器材;\n5. 是否尝试某条雪道、地形或动作的全部决定;\n6. 在感到不安全或不适时停止或拒绝任何活动;\n7. 在需要时寻求医疗救助;\n8. 保持对周围环境及其他滑雪者的注意;\n9. 根据当前雪况调整自身滑行;\n10. 确保自身身心状况适合参加。\n\n本人理解,教练的指导不减轻、也不转移本人对上述事项的个人责任。",
    acknowledge: true,
  },
  {
    id: "risks",
    headingEn: "8. Assumption of risks",
    headingZh: "八、风险承担",
    bodyEn:
      "I acknowledge that skiing and snowboarding are inherently dangerous activities involving risks of SERIOUS INJURY OR DEATH. I agree to assume all risks, dangers and hazards of participating, including but not limited to:\n\n• Collisions with other skiers or snowboarders, trees, rocks, fences, lift towers, buildings, vehicles, equipment, other natural or man-made objects, or other persons;\n• Terrain hazards, including variations in terrain, surface and subsurface conditions; changes in terrain creating blind spots or reduced visibility; cliffs, crevasses and cornices;\n• Weather and environmental conditions, including changing weather, exposure to the elements, lightning, extreme cold, frostbite and hypothermia;\n• Avalanche, and falling or shifting ice and snow;\n• Equipment failure, malfunction or misuse, and improper fit or adjustment of equipment;\n• Becoming lost or separated from the group or from designated areas, and travelling within or beyond ski area boundaries;\n• Infectious disease contracted through viruses, bacteria or other means, which may result in minor, serious or fatal illness;\n• Failure to ski or snowboard within one's ability, or failure to do so safely;\n• Acts or omissions of other participants or third parties;\n• Negligence of the Releasees, including failure to take reasonable steps to safeguard or protect me from, or warn me of, the risks described here.\n\nI FREELY ACCEPT AND FULLY ASSUME ALL SUCH RISKS, DANGERS AND HAZARDS AND THE POSSIBILITY OF PERSONAL INJURY, DEATH AND PROPERTY LOSS OR DAMAGE RESULTING FROM THEM, even if the injury, death, loss or damage occurs in a manner that is not foreseeable at the time I sign this agreement.",
    bodyZh:
      "本人确认,滑雪与单板运动本身具有危险性,存在【重伤或死亡】的风险。本人同意承担参加课程活动的一切风险与危险,包括但不限于:\n\n• 与其他滑雪者或单板者、树木、岩石、围栏、缆车塔架、建筑物、车辆、器材、其他自然或人造物体或他人发生碰撞;\n• 地形危险,包括地形起伏、雪面与雪层状况变化;造成盲区或能见度下降的地形变化;悬崖、裂缝与雪檐;\n• 天气与环境状况,包括天气变化、暴露于自然环境、雷击、极寒、冻伤与失温;\n• 雪崩,以及冰雪坠落或移动;\n• 器材故障、失灵或使用不当,以及器材安装或调校不当;\n• 迷路或与队伍、指定区域走散,以及在雪场界内或界外移动;\n• 通过病毒、细菌或其他途径感染传染性疾病,可能导致轻微、严重甚至致命的疾病;\n• 未在自身能力范围内滑行,或未安全滑行;\n• 其他参加者或第三方的作为或不作为;\n• 免责方的疏忽,包括未采取合理措施保护本人免受上述风险,或未就上述风险作出警示。\n\n本人【自愿接受并完全承担上述全部风险与危险,以及由此可能导致的人身伤害、死亡与财产损失】,即使该等伤害、死亡或损失以本人签署本协议时无法预见的方式发生。",
    acknowledge: true,
  },
];

const ADULT_RELEASE: Clause = {
  id: "release",
  headingEn: "9. Release of liability and waiver of claims",
  headingZh: "九、免责与放弃索赔",
  bodyEn:
    "In consideration of the Releasees permitting my participation in the Ski Lesson Activities, and for other good and valuable consideration, the receipt and sufficiency of which is acknowledged, I hereby WAIVE ANY AND ALL CLAIMS that I have or may have in the future against the Releasees, and RELEASE THE RELEASEES from any and all liability for any loss, damage, expense or injury, including death, that I may suffer, or that may occur to my person or property, or that any of my heirs, next of kin, executors, administrators, assigns and representatives may suffer, as a result of my participation, DUE TO ANY CAUSE WHATSOEVER, INCLUDING NEGLIGENCE, BREACH OF CONTRACT, OR BREACH OF ANY STATUTORY OR OTHER DUTY OF CARE, INCLUDING ANY DUTY OF CARE OWED UNDER THE OCCUPIERS' LIABILITY ACT, ON THE PART OF THE RELEASEES.\n\nThis release applies to claims arising from: failure of the Releasees to take reasonable steps to safeguard or protect me from, or warn me of, the risks described above; breach of warranty or negligence in respect of the design, manufacture, selection, installation, maintenance, rental or provision of equipment or facilities; and any other conduct or omission by the Releasees. It extends to claims for damages resulting in death or property damage.\n\nThis release applies to the fullest extent permitted by the law of Ontario. It does not apply to gross negligence or wilful misconduct, and it does not affect the rights preserved in clause 15.",
  bodyZh:
    "作为免责方允许本人参加课程活动的对价,以及其他充分且有效的对价(本人确认已收到该等对价且其充分),本人在此【放弃现在或将来对免责方的一切索赔】,并【免除免责方的一切责任】,包括本人因参加课程活动而可能遭受的、或本人的人身或财产可能发生的、或本人的继承人、近亲属、遗嘱执行人、遗产管理人、受让人及代表可能遭受的任何损失、损害、费用或伤害(含死亡),【无论其起因为何,包括免责方的疏忽、违约,或违反任何法定或其他注意义务(含《占用者责任法》项下的注意义务)】。\n\n本条适用于因下列事由产生的索赔:免责方未采取合理措施保护本人免受上述风险或未作出警示;在器材或场地的设计、制造、选择、安装、维护、租赁或提供方面的违反保证或疏忽;以及免责方的任何其他作为或不作为。本条亦适用于导致死亡或财产损失的损害赔偿请求。\n\n本条在安大略省法律允许的最大范围内适用,不适用于重大过失或故意不当行为,亦不影响第十五条所保留的权利。",
  acknowledge: true,
};

const GUARDIAN_RELEASE: Clause = {
  id: "release-guardian",
  headingEn: "9. Guardian's release of liability and waiver of claims",
  headingZh: "九、监护人免责与放弃索赔",
  bodyEn:
    "I confirm that I am the parent or legal guardian of the participant named in this agreement.\n\nIn consideration of the Releasees permitting the participant's participation in the Ski Lesson Activities, and for other good and valuable consideration, the receipt and sufficiency of which is acknowledged, I hereby WAIVE ANY AND ALL CLAIMS OF MY OWN that I have or may have in the future against the Releasees, and RELEASE THE RELEASEES from any and all liability for any loss, damage, expense or injury, including death, that I may suffer, or that my heirs, next of kin, executors, administrators, assigns and representatives may suffer, arising out of the participant's participation, DUE TO ANY CAUSE WHATSOEVER, INCLUDING NEGLIGENCE, BREACH OF CONTRACT, OR BREACH OF ANY STATUTORY OR OTHER DUTY OF CARE, INCLUDING ANY DUTY OF CARE OWED UNDER THE OCCUPIERS' LIABILITY ACT, ON THE PART OF THE RELEASEES.\n\nThis release applies to the fullest extent permitted by the law of Ontario. It does not apply to gross negligence or wilful misconduct, and it does not affect the rights preserved in clause 15. Please also read clause 16.",
  bodyZh:
    "本人确认为本协议所载学员的父母或法定监护人。\n\n作为免责方允许该学员参加课程活动的对价,以及其他充分且有效的对价,本人在此【放弃本人现在或将来对免责方的一切索赔】,并【免除免责方的一切责任】,包括本人或本人的继承人、近亲属、遗嘱执行人、遗产管理人、受让人及代表因该学员参加课程活动而可能遭受的任何损失、损害、费用或伤害(含死亡),【无论其起因为何,包括免责方的疏忽、违约,或违反任何法定或其他注意义务(含《占用者责任法》项下的注意义务)】。\n\n本条在安大略省法律允许的最大范围内适用,不适用于重大过失或故意不当行为,亦不影响第十五条所保留的权利。请同时阅读第十六条。",
  acknowledge: true,
};

const TAIL_CLAUSES: Clause[] = [
  {
    id: "indemnity",
    headingEn: "10. Indemnification",
    headingZh: "十、赔偿承诺",
    bodyEn:
      "I agree to HOLD HARMLESS AND INDEMNIFY the Releasees from and against any and all liability for damage to the property of, or personal injury to, any third party resulting from participation in the Ski Lesson Activities, presence on the facilities, or use of the equipment.",
    bodyZh:
      "本人同意就因参加课程活动、进入场地或使用器材而对任何第三方造成的财产损害或人身伤害,【使免责方免受损害并向其作出赔偿】。",
    acknowledge: true,
  },
  {
    id: "medical",
    headingEn: "11. Medical authorisation and fitness to participate",
    headingZh: "十一、医疗授权与参加资格",
    bodyEn:
      "I authorise the Releasees to arrange necessary emergency medical treatment in the event of injury. I understand that I am responsible for all costs of such treatment, transportation and evacuation.\n\nI certify that: I am physically fit and have no medical condition that would prevent safe participation; I have disclosed any relevant medical condition, injury or limitation to the instructor; and I will immediately inform the instructor if my physical condition changes during the activity.",
    bodyZh:
      "本人授权免责方在发生伤害时安排必要的紧急医疗救治。本人理解该等救治、转运与撤离的全部费用由本人承担。\n\n本人声明:身体状况适合安全参加课程活动,无妨碍参加的健康问题;已向教练告知任何相关的健康状况、伤病或身体限制;并将在活动期间身体状况发生变化时立即告知教练。",
    acknowledge: true,
  },
  {
    id: "future-programs",
    headingEn: "12. Application to future lessons",
    headingZh: "十二、对后续课程的适用",
    bodyEn:
      "THIS AGREEMENT APPLIES TO ALL SUBSEQUENT SKI LESSON ACTIVITIES AND PROGRAMS with the Releasees unless I give written notice revoking it. I understand that it covers not only this lesson but all future lessons and programs until formally revoked by me in writing.\n\nAs a matter of practice this site will still ask me to sign again each season. That does not limit this clause.",
    bodyZh:
      "【除非本人以书面方式撤销,本协议适用于本人与免责方之间的所有后续课程活动与项目。】本人理解本协议不仅适用于本次课程,亦适用于此后所有课程,直至本人以书面形式正式撤销为止。\n\n作为操作惯例,本站仍会在每个雪季请本人重新签署一次;这不构成对本条的限制。",
    acknowledge: true,
  },
  {
    id: "governing-law",
    headingEn: "13. Governing law and jurisdiction",
    headingZh: "十三、适用法律与管辖",
    bodyEn:
      "This agreement, and any rights, duties and obligations between the parties, are governed by and interpreted solely in accordance with the laws of Ontario and no other jurisdiction. Any litigation between the parties shall be brought solely in Ontario and within the exclusive jurisdiction of the Courts of Ontario.\n\nThe English version of this agreement governs. The Chinese text is a convenience translation.",
    bodyZh:
      "本协议以及双方之间的权利、义务与责任,【仅】受安大略省法律管辖并据其解释,不适用其他法域的法律。双方之间的任何诉讼【仅】得在安大略省提起,并由安大略省法院专属管辖。\n\n【本协议以英文版本为准】,中文文本仅为方便阅读的译文。",
    acknowledge: true,
  },
  {
    id: "voluntary",
    headingEn: "14. Acknowledgements and voluntary signature",
    headingZh: "十四、确认与自愿签署",
    bodyEn:
      "I acknowledge that: I have carefully read this agreement in its entirety and fully understand its contents; I am aware that it is a release of liability, a waiver of claims, an assumption of risks and a contract; I understand that by signing it I AM WAIVING CERTAIN LEGAL RIGHTS which I or my heirs, next of kin, executors, administrators, assigns and representatives may have against the Releasees, including rights under the Occupiers' Liability Act; I am signing VOLUNTARILY and of my own free will; and no oral or written representations have been made to me that contradict or modify its terms.\n\nIf any portion of this agreement is held invalid, the remaining portions continue in full force and effect. This agreement is binding upon my heirs, next of kin, executors, administrators, assigns and representatives.",
    bodyZh:
      "本人确认:已完整、仔细阅读本协议并充分理解其内容;知悉本协议为免责、放弃索赔、风险承担的合同;理解签署本协议即表示【本人放弃本人或本人的继承人、近亲属、遗嘱执行人、遗产管理人、受让人及代表可能对免责方享有的某些法律权利,包括《占用者责任法》项下的权利】;本人系【自愿】签署;且无任何与本协议条款相抵触或对其作出修改的口头或书面陈述。\n\n本协议任何部分被认定无效的,其余部分继续完全有效。本协议对本人的继承人、近亲属、遗嘱执行人、遗产管理人、受让人及代表具有约束力。",
    acknowledge: true,
  },
  {
    id: "statutory-rights",
    headingEn: "15. Rights this agreement does not affect",
    headingZh: "十五、本协议不影响的权利",
    bodyEn:
      "Nothing in this agreement removes any right I have under consumer protection legislation, or any other right that cannot be waived by agreement. Nothing in it limits liability for gross negligence or wilful misconduct where the law does not permit that liability to be limited.",
    bodyZh:
      "本协议不排除本人在消费者保护法项下享有的任何权利,也不排除法律规定不可通过约定放弃的任何权利。在法律不允许限制的范围内,本协议不限制因重大过失或故意不当行为产生的责任。",
    acknowledge: false,
  },
];

/**
 * Guardian-only, and said plainly rather than buried.
 *
 * In Ontario a parent generally cannot give up a minor's own right to sue.
 * Implying otherwise would be both unenforceable and misleading, so the
 * agreement states the limit instead of leaving the parent to discover it.
 */
const MINOR_NOTICE: Clause = {
  id: "minor-notice",
  headingEn: "16. Important notice about the participant's own rights",
  headingZh: "十六、关于学员本人权利的重要提示",
  bodyEn:
    "This is drawn to your attention deliberately. Under Ontario law a parent or guardian generally CANNOT give up a minor child's own right to bring a claim. Signing this agreement does not prevent the participant from bringing a claim in their own name once they are able to.\n\nClause 9 limits your claims, not theirs. Clause 10, the indemnity, is your own separate promise. Once the participant turns 18 they will be asked to sign for themselves before their next lesson.",
  bodyZh:
    "特此提请注意:根据安大略省法律,父母或监护人通常【无法】放弃未成年子女本人的索赔权利。签署本协议并不妨碍该学员在具备条件后以本人名义提出索赔。\n\n第九条限制的是【你本人】的索赔,而非学员本人的索赔;第十条的赔偿承诺是你本人独立作出的承诺。学员满 18 周岁后,须在下一次课程前由本人签署。",
  acknowledge: true,
};

export function clausesFor(variant: WaiverVariant): Clause[] {
  return variant === "guardian"
    ? [...SHARED_CLAUSES, GUARDIAN_RELEASE, ...TAIL_CLAUSES, MINOR_NOTICE]
    : [...SHARED_CLAUSES, ADULT_RELEASE, ...TAIL_CLAUSES];
}

export function acknowledgementIds(variant: WaiverVariant): string[] {
  return clausesFor(variant)
    .filter((clause) => clause.acknowledge)
    .map((clause) => clause.id);
}

export const TITLE = {
  en: "Ski Lesson Waiver and Release of Liability — Release of Liability, Waiver of Claims, Assumption of Risks and Indemnity Agreement",
  zh: "滑雪课程免责协议 —— 免责、放弃索赔、风险承担与赔偿协议",
} as const;

export const ELECTRONIC_CONSENT = {
  en: "I agree to sign this agreement electronically, and I understand that my electronic signature has the same effect as a handwritten one.",
  zh: "我同意以电子方式签署本协议,并理解电子签名与手写签名具有同等效力。",
} as const;

export const READ_CONFIRMATION = {
  en: "I HAVE READ AND UNDERSTOOD THIS AGREEMENT AND I AM AWARE THAT BY SIGNING IT I AM WAIVING CERTAIN LEGAL RIGHTS.",
  zh: "本人已阅读并理解本协议,且知悉签署本协议即表示放弃某些法律权利。",
} as const;

/**
 * Hash of the exact wording presented. Stored with each signature so we can
 * prove later which text was on screen, independent of what this file says now.
 */
export function templateHash(variant: WaiverVariant): string {
  const payload = JSON.stringify({
    version: TEMPLATE_VERSION,
    revision: TEMPLATE_REVISION,
    title: TITLE,
    warning: WARNING,
    electronicConsent: ELECTRONIC_CONSENT,
    readConfirmation: READ_CONFIRMATION,
    clauses: clausesFor(variant),
  });
  return createHash("sha256").update(payload).digest("hex");
}
