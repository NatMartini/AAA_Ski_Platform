import { describe, expect, it } from "vitest";
import { additionalAttendeesComplete, normalizeAdditionalAttendees, resizeAdditionalAttendees } from "./attendee-form";

describe("group attendee form data", () => {
  const adult = { fullName: "Adult Guest", email: "adult@example.com", isMinor: false };
  const child = { fullName: "Child Guest", email: "guardian@example.com", isMinor: true };

  it("collects exactly the extra people in 1v2/1v3 and never submits removed hidden people", () => {
    expect(resizeAdditionalAttendees([], 1)).toEqual([]);
    expect(resizeAdditionalAttendees([], 2)).toEqual([{ fullName: "", email: "", isMinor: false }]);
    expect(resizeAdditionalAttendees([adult], 3)).toEqual([adult, { fullName: "", email: "", isMinor: false }]);
    expect(resizeAdditionalAttendees([adult, child], 2)).toEqual([adult]);
    expect(resizeAdditionalAttendees([adult, child], 1)).toEqual([]);
    expect(resizeAdditionalAttendees([adult, child], 20)).toEqual([adult, child]);
  });

  it("requires a usable individual signer address without inventing an adult participant owned by the payer", () => {
    expect(additionalAttendeesComplete([])).toBe(true);
    expect(additionalAttendeesComplete([adult, child])).toBe(true);
    expect(additionalAttendeesComplete([{ ...adult, fullName: " " }])).toBe(false);
    expect(additionalAttendeesComplete([{ ...adult, email: "adult" }])).toBe(false);
    expect(additionalAttendeesComplete([{ ...adult, email: "bad email@example.com" }])).toBe(false);
    const normalized = normalizeAdditionalAttendees([{ fullName: " Adult Guest ", email: " Adult@Example.com ", isMinor: false }]);
    expect(normalized).toEqual([{ fullName: "Adult Guest", email: "adult@example.com", isMinor: false }]);
    expect(normalized[0]).not.toHaveProperty("accountId");
    expect(normalized[0]).not.toHaveProperty("participantId");
  });
});
