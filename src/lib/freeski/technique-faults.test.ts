import { describe, expect, it } from "vitest";
import { scorecardSchema, type Scorecard } from "./scorecard";
import { sampleScorecard } from "./scorecard.fixtures";
import { faultById, FAULTS, faultsFor, faultsForAction, GUIDE_DRILLS } from "./technique-faults";

const card = () => scorecardSchema.parse(sampleScorecard);
const withMetric = (base: Scorecard, key: string, score: number, band: "below" | "within" | "above") =>
  ({ ...base, metrics: base.metrics.map(metric => metric.key === key ? { ...metric, score, band } : metric) });

describe("technique faults", () => {
  it("explains every problem with a picture, the guide's advice and drills, and its CSIA criteria", () => {
    for (const fault of FAULTS) {
      for (const text of [fault.zh, fault.en, fault.seeZh, fault.seeEn, fault.whyZh, fault.whyEn, fault.fixZh, fault.fixEn]) expect(text.length).toBeGreaterThan(1);
      expect(fault.criteria.length).toBeGreaterThan(0);
      for (const drill of fault.drills) expect(GUIDE_DRILLS[drill]).toBeDefined();
      for (const cause of fault.causes ?? []) expect(faultById(cause).id).toBe(cause);
    }
  });

  it("points at the problems a score card's short measurements show", () => {
    const found = faultsFor(card());
    expect(found.map(entry => entry.fault.id)).toEqual(["upper_body_leads"]);
    expect(found[0].evidence).toEqual(expect.arrayContaining([expect.objectContaining({ standing: "short", metric: expect.objectContaining({ key: "rotation_rate" }) })]));
    // With every measurement in its range there is nothing to explain.
    const fine = card();
    expect(faultsFor({ ...fine, metrics: fine.metrics.map(metric => ({ ...metric, band: "within" as const })) })).toEqual([]);
  });

  it("puts the furthest short first and keeps three", () => {
    const worse = withMetric(withMetric(card(), "parallel_skis", 40, "below"), "turn_closure", 55, "below");
    expect(faultsFor(worse).map(entry => entry.fault.id)).toEqual(["tipping_inside", "skis_apart", "turn_unfinished"]);
    expect(faultsFor(worse, 10).map(entry => entry.fault.id)).toContain("upper_body_leads");
  });

  it("lists the problems that bear on what an action and level is judged on", () => {
    const short = faultsForAction("short_turn", 3).map(fault => fault.id);
    expect(short).toEqual(expect.arrayContaining(["upper_body_leads", "turn_unfinished", "skis_apart", "edge_slips"]));
    expect(faultsForAction("unknown_action", 2)).toEqual([]);
  });
});
