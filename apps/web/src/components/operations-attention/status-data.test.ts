import { describe, expect, it } from "vitest";
import { readStatus } from "./status-data.ts";

describe("the facts of the header in the status answer", () => {
  const answer = { events: [], hasMore: false, checkedAt: 1 };

  it("reads the login of the viewer and the alert count", () => {
    const status = readStatus({ ...answer, viewerLogin: "octo-maintainer", alertCount: 60 });
    expect(status).toMatchObject({ viewerLogin: "octo-maintainer", alertCount: 60 });
  });

  it("reads an answer that lacks them", () => {
    const status = readStatus(answer);
    expect(status.viewerLogin).toBeUndefined();
    expect(status.alertCount).toBeUndefined();
  });
});
