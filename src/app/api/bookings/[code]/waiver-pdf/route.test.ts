import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn(), access: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: mocks.auth }));
vi.mock("@/lib/booking/access", () => ({ loadBooking: mocks.load, accessFor: mocks.access }));
vi.mock("@/lib/storage", () => ({ readObject: mocks.read }));
import { GET } from "./route";
const ctx = { params: Promise.resolve({ code: "SKI-GROUP" }) };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, user: { id: "buyer" } });
  mocks.access.mockReturnValue({ canView: true, isAnyCoach: false });
  mocks.load.mockResolvedValue({ code: "SKI-GROUP", waiver: { signerUserId: "buyer", signedPdfKey: "primary.pdf" }, attendees: [
    { id: "guest", ordinal: 2, waiver: { signerUserId: "actual-guest", signedPdfKey: "guest.pdf" } },
  ] });
  mocks.read.mockResolvedValue(Buffer.from("%PDF-1.7"));
});
describe("group signed waiver privacy", () => {
  it("does not give an order buyer another adult's signed PDF", async () => {
    expect((await GET(new Request("http://localhost/api?attendee=guest"), ctx)).status).toBe(403);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("lets the actual adult signer or guardian download their own record", async () => {
    mocks.auth.mockResolvedValue({ ok: true, user: { id: "actual-guest" } });
    mocks.access.mockReturnValue({ canView: false, isAnyCoach: false });
    const response = await GET(new Request("http://localhost/api?attendee=guest"), ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.read).toHaveBeenCalledWith("guest.pdf");
  });
  it("lets coaches download attendee records for lesson coverage", async () => {
    mocks.access.mockReturnValue({ canView: true, isAnyCoach: true });
    expect((await GET(new Request("http://localhost/api?attendee=guest"), ctx)).status).toBe(200);
  });

  it("preserves the shared read-only records available to platform coaches", async () => {
    mocks.access.mockReturnValue({ canView: true, isAnyCoach: true, isCoach: false });
    expect((await GET(new Request("http://localhost/api?attendee=guest"), ctx)).status).toBe(200);
  });
  it("rejects a guessed attendee from another order before touching storage", async () => {
    expect((await GET(new Request("http://localhost/api?attendee=another-order-person"), ctx)).status).toBe(404);
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
