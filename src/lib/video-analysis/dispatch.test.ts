import { describe, expect, it, vi } from "vitest";
import { claimNextAnalysisJob, specifiedAnalysisScope, type AnalysisClaim } from "./dispatch";

describe("shared FreeSki worker dispatch", () => {
  it("alternates loaded queues so neither account grants nor courses starve", async () => {
    const claimBooking = vi.fn(async () => ({ id: "booking" }));
    const claimAccount = vi.fn(async () => ({ id: "account" }));
    const scopes: string[] = [];
    let preferAccount: boolean = false;
    for (let i = 0; i < 8; i++) {
      const claim: AnalysisClaim<{ id: string }> = await claimNextAnalysisJob({ preferAccount, claimBooking, claimAccount });
      scopes.push(claim!.scope);
      preferAccount = claim!.preferAccountNext;
    }
    expect(scopes).toEqual(["booking", "account", "booking", "account", "booking", "account", "booking", "account"]);
    expect(claimBooking).toHaveBeenCalledTimes(4);
    expect(claimAccount).toHaveBeenCalledTimes(4);
  });

  it.each([false, true])("tries the other queue when the preferred one is empty (%s)", async (preferAccount) => {
    const preferred = vi.fn(async () => null);
    const other = vi.fn(async () => ({ id: "job" }));
    const claim = await claimNextAnalysisJob({ preferAccount,
      claimBooking: preferAccount ? other : preferred, claimAccount: preferAccount ? preferred : other });
    expect(claim?.scope).toBe(preferAccount ? "booking" : "account");
    expect(preferred).toHaveBeenCalledOnce();
    expect(other).toHaveBeenCalledOnce();
  });

  it.each(["booking", "account"] as const)("dispatches explicit %s IDs solely to that scope", async (specifiedScope) => {
    const claimBooking = vi.fn(async () => null);
    const claimAccount = vi.fn(async () => null);
    expect(await claimNextAnalysisJob({ preferAccount: specifiedScope !== "account", jobId: "requested-id",
      specifiedScope, claimBooking, claimAccount })).toBeNull();
    const selected = specifiedScope === "account" ? claimAccount : claimBooking;
    const unselected = specifiedScope === "account" ? claimBooking : claimAccount;
    expect(selected).toHaveBeenCalledExactlyOnceWith("requested-id");
    expect(unselected).not.toHaveBeenCalled();
  });

  it("refuses ambiguous cross-table IDs instead of silently using the wrong ledger", () => {
    expect(() => specifiedAnalysisScope(true, true)).toThrow("Ambiguous analysis job scope");
    expect(specifiedAnalysisScope(true, false)).toBe("booking");
    expect(specifiedAnalysisScope(false, true)).toBe("account");
  });
});
