import { describe, expect, it } from "vitest";
import {
  checkPackageUse,
  hoursUsed,
  isOfferOnSale,
  offersOnSale,
  packageValueCents,
  settlementFor,
  type PackageForUse,
} from "./packages";

const BLUE = "resort_blue";

const pkg = (over: Partial<PackageForUse> = {}): PackageForUse => ({
  status: "ACTIVE",
  resortId: BLUE,
  lessonType: "riding",
  season: "2026-27",
  hours: 4,
  hoursUsed: 0,
  ...over,
});

const lesson = {
  resortId: BLUE,
  lessonType: "riding",
  season: "2026-27",
  hours: 2,
  headcount: 1,
};

describe("offersOnSale", () => {
  it("sells the Blue Mountain package until 1 December", () => {
    const autumn = offersOnSale("2026-11-30");
    expect(autumn.season).toBe("2026-27");
    expect(autumn.offers.map((o) => o.key)).toEqual(["blue-mountain-4h"]);
    expect(autumn.offers[0]).toMatchObject({ hours: 4, priceCents: 18000 });
    expect(offersOnSale("2026-12-01").offers).toHaveLength(1);
  });

  it("stops selling once the early bird is over", () => {
    expect(offersOnSale("2026-12-02").offers).toEqual([]);
    expect(offersOnSale("2027-02-14").offers).toEqual([]);
  });
});

describe("isOfferOnSale", () => {
  it("matches the offer and the season it was ordered for", () => {
    expect(isOfferOnSale("blue-mountain-4h", "2026-27", "2026-11-01")).toBe(true);
    expect(isOfferOnSale("blue-mountain-4h", "2026-27", "2026-12-02")).toBe(false);
    expect(isOfferOnSale("blue-mountain-4h", "2025-26", "2026-11-01")).toBe(false);
    expect(isOfferOnSale("no-such-offer", "2026-27", "2026-11-01")).toBe(false);
  });
});

describe("hoursUsed", () => {
  it("counts held and taught lessons, and gives back expired or cancelled ones", () => {
    expect(
      hoursUsed([
        { hours: 2, status: "CONFIRMED" },
        { hours: 2, status: "HOLD" },
        { hours: 2, status: "COMPLETED" },
        { hours: 2, status: "EXPIRED" },
        { hours: 2, status: "CANCELLED" },
      ]),
    ).toBe(6);
  });

  it("gives back a hold whose timer ran out before the sweeper saw it", () => {
    const now = new Date("2026-11-20T15:00:00Z");
    expect(
      hoursUsed(
        [
          { hours: 2, status: "HOLD", holdExpiresAt: new Date("2026-11-20T14:59:00Z") },
          { hours: 2, status: "HOLD", holdExpiresAt: new Date("2026-11-20T15:20:00Z") },
        ],
        now,
      ),
    ).toBe(2);
  });
});

describe("checkPackageUse", () => {
  it("covers a two-hour ski lesson at the right resort", () => {
    expect(checkPackageUse(pkg(), lesson)).toEqual({ ok: true });
    expect(checkPackageUse(pkg({ hoursUsed: 2 }), lesson)).toEqual({ ok: true });
  });

  it("refuses more hours than are left", () => {
    expect(checkPackageUse(pkg({ hoursUsed: 3 }), lesson)).toEqual({
      ok: false,
      reason: "package-insufficient-hours",
    });
  });

  it("refuses an unpaid package", () => {
    expect(
      checkPackageUse(pkg({ status: "PENDING_PAYMENT_REVIEW" }), lesson),
    ).toMatchObject({ reason: "package-not-active" });
  });

  it("only pays for what it was sold for", () => {
    expect(
      checkPackageUse(pkg(), { ...lesson, resortId: "resort_msl" }),
    ).toMatchObject({ reason: "package-wrong-resort" });
    expect(
      checkPackageUse(pkg(), { ...lesson, lessonType: "park" }),
    ).toMatchObject({ reason: "package-wrong-lesson-type" });
    expect(
      checkPackageUse(pkg(), { ...lesson, season: "2027-28" }),
    ).toMatchObject({ reason: "package-wrong-season" });
    expect(
      checkPackageUse(pkg(), { ...lesson, headcount: 2 }),
    ).toMatchObject({ reason: "package-group" });
  });
});

describe("settlementFor", () => {
  const KEVIN = "kevin";
  const ALISA = "alisa";

  it("values package hours pro rata", () => {
    expect(packageValueCents({ priceCents: 18000, hours: 4 }, 2)).toBe(9000);
  });

  it("makes the paid coach owe the coach who taught", () => {
    const packages = [
      {
        payeeCoachId: KEVIN,
        priceCents: 18000,
        hours: 4,
        uses: [
          { coachId: KEVIN, hours: 2 },
          { coachId: ALISA, hours: 2 },
        ],
      },
    ];
    expect(settlementFor(KEVIN, packages)).toEqual([
      {
        otherCoachId: ALISA,
        theyTaughtHours: 2,
        iOweCents: 9000,
        iTaughtHours: 0,
        owedToMeCents: 0,
        netCents: -9000,
      },
    ]);
    expect(settlementFor(ALISA, packages)[0]).toMatchObject({
      otherCoachId: KEVIN,
      iTaughtHours: 2,
      owedToMeCents: 9000,
      netCents: 9000,
    });
  });

  it("nets debts in both directions", () => {
    const packages = [
      {
        payeeCoachId: KEVIN,
        priceCents: 18000,
        hours: 4,
        uses: [{ coachId: ALISA, hours: 4 }],
      },
      {
        payeeCoachId: ALISA,
        priceCents: 18000,
        hours: 4,
        uses: [{ coachId: KEVIN, hours: 2 }],
      },
    ];
    expect(settlementFor(KEVIN, packages)[0].netCents).toBe(-18000 + 9000);
  });

  it("owes nothing when the paid coach taught every hour", () => {
    expect(
      settlementFor(KEVIN, [
        {
          payeeCoachId: KEVIN,
          priceCents: 18000,
          hours: 4,
          uses: [{ coachId: KEVIN, hours: 4 }],
        },
      ]),
    ).toEqual([]);
  });
});
