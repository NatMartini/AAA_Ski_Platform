import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleSwitch } from "./locale-switch";

const mocks = vi.hoisted(() => ({ replace: vi.fn(), query: "", pending: false }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }), usePathname: () => "/book/msl/coaches" }));
vi.mock("next/navigation", () => ({ useParams: () => ({ locale: "zh", resort: "msl" }), useSearchParams: () => new URLSearchParams(mocks.query) }));
vi.mock("react", async (importOriginal) => ({ ...await importOriginal<typeof import("react")>(), useTransition: () => [mocks.pending, (action: () => void) => action()] }));

type SwitchButton = ReactElement<{ onClick: () => void; disabled: boolean; children: string }>;
function englishButton() {
  const tree = LocaleSwitch({ current: "zh" });
  const buttons = (tree.props.children as [unknown, SwitchButton[]])[1];
  return buttons.find((button) => button.props.children === "EN")!;
}
beforeEach(() => { vi.clearAllMocks(); mocks.query = ""; mocks.pending = false; });

describe("language switch with booking context", () => {
  it("preserves complete booking selection and optional preference query", () => {
    mocks.query = "date=2026-12-04&startHour=9&hours=2&requestedSkills=parallel%2Ccustom%3A123&level=advanced&headcount=3&lessonType=riding&recommend=true";
    englishButton().props.onClick();
    expect(mocks.replace).toHaveBeenCalledWith({ pathname: "/book/msl/coaches", params: { locale: "zh", resort: "msl" },
      query: { date: "2026-12-04", startHour: "9", hours: "2", requestedSkills: "parallel,custom:123", level: "advanced", headcount: "3", lessonType: "riding", recommend: "true" } }, { locale: "en" });
  });
  it("preserves duplicate query values so validation behavior does not change", () => {
    mocks.query = "hours=2&hours=3";
    englishButton().props.onClick();
    expect(mocks.replace.mock.calls[0][0].query.hours).toEqual(["2", "3"]);
  });
  it("treats hostile object keys as data without changing query object inheritance", () => {
    mocks.query = "__proto__=evil&constructor=x&date=2026-12-04";
    englishButton().props.onClick();
    const query = mocks.replace.mock.calls[0][0].query;
    expect(Object.getPrototypeOf(query)).toBeNull();
    expect(query.__proto__).toBe("evil");
    expect(query.constructor).toBe("x");
  });
  it("disables another locale navigation while a transition is pending", () => {
    mocks.pending = true;
    expect(englishButton().props.disabled).toBe(true);
  });
});
