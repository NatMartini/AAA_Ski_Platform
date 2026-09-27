/**
 * ⚠ DRAFT — these are working texts, not lawyer-reviewed copy.
 *
 * They exist so the site is not shipping with dead links where its policies
 * should be, and so the retention and consent statements match what the code
 * actually does. Have them reviewed before taking real bookings.
 *
 * Placeholders in ALL CAPS must be filled in before launch.
 */

export type LegalSection = {
  heading: string;
  paragraphs: string[];
};

export type LegalContent = {
  title: string;
  sections: LegalSection[];
  updated: string;
};

export type LegalDocId = "terms" | "privacy" | "accessibility";

const UPDATED_EN = "Draft — pending legal review. Last updated 11 August 2026.";
const UPDATED_ZH = "草稿 —— 尚待法律审阅。最后更新:2026 年 8 月 11 日。";

export const LEGAL_DOCS: Record<
  LegalDocId,
  { en: LegalContent; zh: LegalContent }
> = {
  terms: {
    en: {
      title: "Terms of service",
      updated: UPDATED_EN,
      sections: [
        {
          heading: "What this site is",
          paragraphs: [
            "This is a private booking tool for ski and snowboard lessons taught by INSTRUCTOR NAME(S). It is not open to the public: access is by invitation from your instructor.",
            "The lesson agreement is between you and the instructor personally. The site records bookings and payment confirmations; it does not itself handle money.",
          ],
        },
        {
          heading: "Booking and lesson times",
          paragraphs: [
            "Lessons are booked on the hour, with a two-hour minimum. Every lesson starts five minutes after the booked hour and finishes five minutes before it ends, so the instructor can hand over to the next student. A 1:00–3:00 booking is taught 1:05–2:55.",
            "Because that handover happens once per booking regardless of length, a fixed credit is deducted once per booking, not per hour. The full breakdown is shown before you confirm.",
          ],
        },
        {
          heading: "Payment",
          paragraphs: [
            "Payment is made directly to your instructor by Interac e-Transfer, WeChat Pay or Alipay, and confirmed by uploading a screenshot. Your booking is confirmed once the instructor has checked it.",
            "Prices are in Canadian dollars.",
          ],
        },
        {
          heading: "Cancellation and refunds",
          paragraphs: [
            "Your instructor's cancellation policy is shown in full before you confirm a booking, and a copy is frozen onto that booking. Later changes to the policy do not affect bookings already made.",
          ],
        },
        {
          heading: "Waiver",
          paragraphs: [
            "A liability waiver must be signed before a lesson. It is signed once per instructor per season. Adults sign for themselves; for participants under 18 a parent or guardian signs.",
          ],
        },
        {
          heading: "Lift tickets and resort rules",
          paragraphs: [
            "You are responsible for your own lift ticket or pass, and for following the resort's rules. The instructor does not operate the resort.",
          ],
        },
        {
          heading: "Your rights",
          paragraphs: [
            "Nothing in these terms removes any right you have under consumer protection legislation or any other right that cannot be waived by agreement.",
          ],
        },
        {
          heading: "Contact",
          paragraphs: ["Questions about a booking: CONTACT EMAIL."],
        },
      ],
    },
    zh: {
      title: "服务条款",
      updated: UPDATED_ZH,
      sections: [
        {
          heading: "本站是什么",
          paragraphs: [
            "本站是 教练姓名 的私人滑雪 / 单板课程预定工具,不对公众开放,仅供教练邀请的学员使用。",
            "课程合同存在于你与教练本人之间。本站仅记录预定与收款确认,不经手资金。",
          ],
        },
        {
          heading: "预定与上课时间",
          paragraphs: [
            "课程按整点预定,最少两小时。每节课在预定时段开始 5 分钟后开始、结束前 5 分钟结束,以便教练与下一位学员交接。预定 1:00–3:00,实际授课时间为 1:05–2:55。",
            "由于交接每张订单只发生一次,与时长无关,因此每张订单固定扣减一次,而非按小时扣减。确认下单前会完整展示价格明细。",
          ],
        },
        {
          heading: "付款",
          paragraphs: [
            "款项通过 Interac e-Transfer、微信支付或支付宝直接支付给教练,并上传付款截图确认。教练核对后订单即预定成功。",
            "所有价格以加元计。",
          ],
        },
        {
          heading: "取消与退款",
          paragraphs: [
            "教练的取消政策会在你确认下单前完整展示,并冻结保存到该订单上。政策日后修改不影响已成立的订单。",
          ],
        },
        {
          heading: "免责协议",
          paragraphs: [
            "上课前须签署免责协议,每位教练每个雪季签一次。成年学员由本人签署;未满 18 周岁的学员由父母或法定监护人签署。",
          ],
        },
        {
          heading: "雪票与雪场规定",
          paragraphs: [
            "你需自行持有有效雪票或季卡,并遵守雪场规定。教练并非雪场经营者。",
          ],
        },
        {
          heading: "你的权利",
          paragraphs: [
            "本条款不排除你在消费者保护法下享有的任何权利,也不排除法律规定不可通过约定放弃的任何权利。",
          ],
        },
        {
          heading: "联系方式",
          paragraphs: ["订单相关问题请联系:联系邮箱。"],
        },
      ],
    },
  },

  privacy: {
    en: {
      title: "Privacy policy",
      updated: UPDATED_EN,
      sections: [
        {
          heading: "What we collect",
          paragraphs: [
            "Your name and email address from your Google account when you sign in. We request only your basic profile and email — nothing else, and no access to your Google Calendar, Drive or contacts.",
            "For each participant: their name, whether they are under 18, and optionally an emergency contact and ability level. We do not collect a date of birth; the under-18 flag decides whether a guardian must sign the waiver.",
            "When you sign a waiver: your drawn signature, your typed name, the time, your IP address and your browser's user agent string. These make the signature evidentially meaningful.",
            "When you pay: the screenshot you upload, the method and any reference you enter.",
            "After a lesson, the instructor may upload short lesson videos for feedback. A clip may contain the participant's image and any caption the instructor adds.",
          ],
        },
        {
          heading: "Payment screenshots",
          paragraphs: [
            "These often show a bank balance or account number. They are stored outside the public web root and are readable only by you and the instructor for that booking — never by anyone who simply has a link.",
            "Please cover anything you would rather not share before uploading.",
          ],
        },
        {
          heading: "Children's information",
          paragraphs: [
            "Information about a participant under 18 is provided and consented to by their parent or guardian through that adult's own account. We collect the minimum needed to run the lesson safely. Lesson videos may include that participant and are kept private to the booking account and instructor.",
          ],
        },
        {
          heading: "How long we keep it",
          paragraphs: [
            "Payment screenshots are deleted automatically 24 months after they are submitted. The booking record itself, without the image, is kept.",
            "A screenshot that was never submitted, was replaced, or was rejected is removed earlier through routine cleanup once it is no longer attached to a booking.",
            "Lesson videos have no automatic deletion date. They remain with the booking until the instructor deletes them; you may also ask for a clip to be removed by contacting CONTACT EMAIL.",
            "Signed waivers are kept for at least seven years and are never deleted automatically. A waiver for someone marked as under 18 requires manual review before deletion because the site does not collect a date of birth and cannot calculate when that person turns 18.",
          ],
        },
        {
          heading: "Who we share it with",
          paragraphs: [
            "Nobody. Your details are visible to you and to the instructor you booked with. There is no analytics, no advertising and no third-party tracking on this site.",
          ],
        },
        {
          heading: "Email",
          paragraphs: [
            "We send booking confirmations, waiver signing links and payment updates. These are about your own booking. There is no mailing list and no marketing email.",
          ],
        },
        {
          heading: "Access and correction",
          paragraphs: [
            "To see, correct or delete what we hold about you, contact CONTACT EMAIL. Note that a signed waiver cannot be altered — a correction is made by signing a new one and marking the old one withdrawn.",
          ],
        },
      ],
    },
    zh: {
      title: "隐私政策",
      updated: UPDATED_ZH,
      sections: [
        {
          heading: "我们收集什么",
          paragraphs: [
            "登录时从你的 Google 账号获取姓名和邮箱。我们仅申请基本资料与邮箱权限,不读取你的日历、云端硬盘或通讯录。",
            "每位学员:姓名、是否未满 18 周岁,以及可选的紧急联系人与水平。本站不收集出生日期;未成年人标记用于判断是否需要监护人签署免责协议。",
            "签署免责协议时:手写签名、打印姓名、签署时间、IP 地址与浏览器 User-Agent。这些是使签名具备证据意义的必要信息。",
            "付款时:你上传的截图、付款方式与你填写的备注。",
            "课程结束后,教练可上传用于课后反馈的课程视频片段。片段可能包含学员影像及教练填写的说明。",
          ],
        },
        {
          heading: "付款截图",
          paragraphs: [
            "付款截图常包含账户余额或账号。这些文件存放在网站公开目录之外,只有你本人和该订单的教练可以查看 —— 仅凭链接无法访问。",
            "上传前请遮挡你不希望被看到的信息。",
          ],
        },
        {
          heading: "未成年人信息",
          paragraphs: [
            "未满 18 周岁学员的信息,由其父母或监护人通过本人账号提供并同意。我们只收集保障课程安全所必需的最少信息。课程视频可能包含该学员,且仅限预定账号与教练查看。",
          ],
        },
        {
          heading: "保留期限",
          paragraphs: [
            "付款截图在提交 24 个月后自动删除;订单记录本身(不含图片)予以保留。",
            "未完成提交、已被替换或被拒绝的付款截图,会在不再关联任何订单后通过例行清理提前删除。",
            "课程视频目前不设自动删除日期,会随订单保留至教练删除;你也可联系 联系邮箱 要求删除片段。",
            "已签署的免责协议至少保留 7 年,且不会自动删除。对于签署时标记为未满 18 周岁的学员,由于本站不收集出生日期、无法自动计算其成年日期,删除前须人工审核。",
          ],
        },
        {
          heading: "是否对外共享",
          paragraphs: [
            "不共享。你的信息仅你本人与所约教练可见。本站没有任何分析统计、广告或第三方追踪。",
          ],
        },
        {
          heading: "邮件",
          paragraphs: [
            "我们会发送订单确认、签字链接与付款状态更新,均与你自己的订单有关。本站没有邮件订阅列表,也不发送营销邮件。",
          ],
        },
        {
          heading: "查询与更正",
          paragraphs: [
            "如需查询、更正或删除我们持有的你的信息,请联系:联系邮箱。请注意:已签署的免责协议不可修改,更正的方式是重新签署一份并将旧的标记为作废。",
          ],
        },
      ],
    },
  },

  accessibility: {
    en: {
      title: "Accessibility",
      updated: UPDATED_EN,
      sections: [
        {
          heading: "Our commitment",
          paragraphs: [
            "We aim to make booking a lesson usable for everyone. The site is built to be operable by keyboard, to work with screen readers, and to keep text readable at high zoom.",
          ],
        },
        {
          heading: "If something does not work for you",
          paragraphs: [
            "If any part of the booking process is difficult to use, contact your instructor on WeChat or at CONTACT EMAIL and they will take the booking for you directly. You will never be required to use this site to book a lesson.",
          ],
        },
        {
          heading: "Feedback",
          paragraphs: [
            "We welcome feedback on accessibility and will respond as quickly as we can. Contact: CONTACT EMAIL.",
          ],
        },
      ],
    },
    zh: {
      title: "无障碍服务",
      updated: UPDATED_ZH,
      sections: [
        {
          heading: "我们的承诺",
          paragraphs: [
            "我们希望所有人都能顺利完成预定。本站在设计上支持纯键盘操作、兼容屏幕阅读器,并在放大显示时保持文字清晰可读。",
          ],
        },
        {
          heading: "如果你在使用中遇到困难",
          paragraphs: [
            "如果预定流程中任何环节使用不便,可直接微信联系教练或发邮件至 联系邮箱,由教练代为登记。预定课程并非必须通过本站完成。",
          ],
        },
        {
          heading: "反馈",
          paragraphs: [
            "欢迎就无障碍问题向我们反馈,我们会尽快回复。联系方式:联系邮箱。",
          ],
        },
      ],
    },
  },
};
