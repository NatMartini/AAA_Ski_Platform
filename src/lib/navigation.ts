import type { Tone } from "@/components/ui/tone";

/**
 * The site map, grouped by what people come to do. Every page belongs to one
 * section; the header shows the sections and, inside a section, its pages.
 * Students and coaches get different maps and never see each other's links.
 */
export type NavIcon = "home" | "book" | "lessons" | "video" | "dashboard" | "students" | "admin";

export type NavItem = {
  href: string;
  zh: string;
  en: string;
  /** Other path prefixes that count as this page (e.g. a booking detail). */
  match?: string[];
};

export type NavSection = NavItem & {
  key: string;
  icon: NavIcon;
  tone: Tone;
  /** Only the exact path counts, e.g. the home page. */
  exact?: boolean;
  items: NavItem[];
};

const STUDENT: NavSection[] = [
  { key: "home", href: "/", zh: "首页", en: "Home", icon: "home", tone: "book", exact: true, items: [] },
  {
    key: "book", href: "/book", zh: "约课", en: "Book", icon: "book", tone: "book",
    items: [
      { href: "/book", zh: "预约课程", en: "Book a lesson" },
      { href: "/prices", zh: "价目表", en: "Prices" },
      { href: "/packages", zh: "课时包", en: "Packages" },
      { href: "/calendar", zh: "教练日历", en: "Coach calendar" },
    ],
  },
  {
    key: "lessons", href: "/my/bookings", zh: "我的课程", en: "My lessons", icon: "lessons", tone: "lessons",
    items: [{ href: "/my/bookings", zh: "我的预约", en: "My bookings", match: ["/booking"] }],
  },
  {
    key: "video", href: "/video-analysis", zh: "视频分析", en: "Video analysis", icon: "video", tone: "video",
    items: [{ href: "/video-analysis", zh: "视频库", en: "Video library" }],
  },
];

const COACH: NavSection[] = [
  { key: "dashboard", href: "/coach", zh: "工作台", en: "Dashboard", icon: "dashboard", tone: "book", exact: true, items: [] },
  {
    key: "lessons", href: "/coach/schedule", zh: "课程", en: "Lessons", icon: "lessons", tone: "lessons",
    items: [
      { href: "/coach/schedule", zh: "已排课程", en: "Schedule" },
      { href: "/coach/bookings", zh: "订单", en: "Bookings", match: ["/booking"] },
      { href: "/coach/bookings/new", zh: "代学员建课", en: "Book for a student" },
      { href: "/coach/availability", zh: "可约时间", en: "Availability" },
      { href: "/calendar", zh: "教练日历", en: "Calendar" },
    ],
  },
  {
    key: "students", href: "/coach/students", zh: "学员", en: "Students", icon: "students", tone: "people",
    items: [
      { href: "/coach/students", zh: "学员", en: "Students" },
      { href: "/coach/packages", zh: "课时包", en: "Packages" },
    ],
  },
  {
    key: "video", href: "/video-analysis", zh: "视频", en: "Video", icon: "video", tone: "video",
    items: [
      { href: "/video-analysis", zh: "视频分析", en: "Video analysis" },
      { href: "/coach/video-analysis", zh: "发放次数", en: "Issue credits" },
      { href: "/coach/video-reviews", zh: "视频点评", en: "Video reviews" },
    ],
  },
  {
    key: "admin", href: "/coach/stats", zh: "管理", en: "Manage", icon: "admin", tone: "admin",
    items: [
      { href: "/coach/stats", zh: "统计", en: "Stats" },
      { href: "/coach/settings", zh: "设置", en: "Settings" },
    ],
  },
];

const PUBLIC: NavSection[] = [
  { key: "home", href: "/", zh: "首页", en: "Home", icon: "home", tone: "book", exact: true, items: [] },
  { key: "video", href: "/video-analysis", zh: "视频分析", en: "Video analysis", icon: "video", tone: "video", items: [] },
];

export function navSections(role: "CUSTOMER" | "COACH" | "ADMIN" | null): NavSection[] {
  if (role === "COACH" || role === "ADMIN") return COACH;
  return role ? STUDENT : PUBLIC;
}

/** True when `pathname` is `prefix` or a page underneath it. */
function under(pathname: string, prefix: string) {
  return prefix === "/" ? pathname === "/" : pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function itemScore(pathname: string, item: NavItem) {
  return Math.max(-1, ...[item.href, ...(item.match ?? [])].filter((prefix) => under(pathname, prefix)).map((prefix) => prefix.length));
}

/** The section and page the path belongs to; the longest matching prefix wins. */
export function activeNav(pathname: string, sections: readonly NavSection[]) {
  let best: { section: NavSection; item: NavItem | null; score: number } | null = null;
  for (const section of sections) {
    const candidates: { item: NavItem | null; score: number }[] = section.exact
      ? [{ item: null, score: pathname === section.href ? section.href.length : -1 }]
      : [{ item: null, score: itemScore(pathname, section) }, ...section.items.map((item) => ({ item, score: itemScore(pathname, item) }))];
    for (const candidate of candidates) {
      if (candidate.score >= 0 && (!best || candidate.score > best.score || (candidate.score === best.score && candidate.item && !best.item)))
        best = { section, ...candidate };
    }
  }
  return { section: best?.section ?? null, item: best?.item ?? null };
}
