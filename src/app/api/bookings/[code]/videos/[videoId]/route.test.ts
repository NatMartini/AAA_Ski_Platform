import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ auth: vi.fn(), booking: vi.fn(), access: vi.fn(), video: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: mock.auth }));
vi.mock("@/lib/booking/access", () => ({ loadBooking: mock.booking, accessFor: mock.access }));
vi.mock("@/lib/prisma", () => ({ prisma: { lessonVideo: { findFirst: mock.video } } }));
vi.mock("@/lib/storage", () => ({ readObject: mock.read, deleteObject: vi.fn() }));
import { GET } from "./route";
const context = { params: Promise.resolve({ code: "SKI-TEST", videoId: "clip" }) };
beforeEach(() => {
  vi.resetAllMocks();
  mock.auth.mockResolvedValue({ ok: true, user: { id: "coach", role: "COACH" } });
  mock.booking.mockResolvedValue({ id: "booking", accountId: "student", coachId: "coach" });
  mock.access.mockReturnValue({ canView: true, isCustomer: false, isCoach: true });
  mock.video.mockResolvedValue({ storageKey: "private/clip.mp4", contentType: "video/mp4" });
  mock.read.mockResolvedValue(Buffer.from("clip"));
});
describe("legacy lesson video route cannot bypass human-review permissions", () => {
  it("lets the course's own coach view regular lesson footage", async () => {
    const response = await GET(new Request("http://localhost/clip"), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("does not grant an unrelated coach or administrator access via shared booking visibility", async () => {
    for (const role of ["COACH", "ADMIN"]) {
      mock.auth.mockResolvedValue({ ok: true, user: { id: "unassigned", role } });
      expect((await GET(new Request("http://localhost/clip"), context)).status).toBe(403);
    }
    expect(mock.video).not.toHaveBeenCalled();
    expect(mock.read).not.toHaveBeenCalled();
  });
  it("lets the owner view a clip and refuses cross-booking video identifiers", async () => {
    mock.auth.mockResolvedValue({ ok: true, user: { id: "student", role: "CUSTOMER" } });
    mock.access.mockReturnValue({ canView: true, isCustomer: true, isCoach: false });
    mock.video.mockResolvedValue(null);
    expect((await GET(new Request("http://localhost/clip"), context)).status).toBe(404);
    expect(mock.video).toHaveBeenCalledWith({ where: { id: "clip", bookingId: "booking" } });
  });
});
