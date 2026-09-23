import { afterEach, describe, expect, it, vi } from "vitest";
import { activeWorkerVersion } from "./worker.ts";

const currentVersion = "11111111-1111-4111-8111-111111111111";
const oldVersion = "22222222-2222-4222-8222-222222222222";

afterEach(() => vi.restoreAllMocks());

describe("one-time repair Worker deployment guard", () => {
  it("reads the active version from Cloudflare's nested deployments result", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        success: true,
        result: {
          deployments: [
            {
              created_on: "2026-09-23T05:00:00Z",
              versions: [{ percentage: 100, version_id: oldVersion }],
            },
            {
              created_on: "2026-09-23T05:01:00Z",
              versions: [{ percentage: 100, version_id: currentVersion }],
            },
          ],
        },
      }),
    );

    expect(await activeWorkerVersion("scoped-token")).toBe(currentVersion);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/b04f3af3f0f10a6b9481bc23ba974eca/workers/scripts/visonaut-diagnostics/deployments",
      expect.objectContaining({
        headers: { Authorization: "Bearer scoped-token" },
        redirect: "error",
      }),
    );
  });

  it("refuses the old flat shape and split traffic", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(Response.json({ success: true, result: [] }));
    await expect(activeWorkerVersion("scoped-token")).rejects.toMatchObject({
      code: "deployment_unavailable",
    });

    fetchMock.mockResolvedValueOnce(
      Response.json({
        success: true,
        result: {
          deployments: [
            {
              created_on: "2026-09-23T05:01:00Z",
              versions: [
                { percentage: 50, version_id: currentVersion },
                { percentage: 50, version_id: oldVersion },
              ],
            },
          ],
        },
      }),
    );
    await expect(activeWorkerVersion("scoped-token")).rejects.toMatchObject({
      code: "deployment_not_exclusive",
    });
  });
});
