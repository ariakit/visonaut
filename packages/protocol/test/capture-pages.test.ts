import { describe, expect, it } from "vitest";
import {
  CAPTURE_PAGE_MAX_BYTES,
  CAPTURE_PAGE_ROWS,
  CAPTURE_PAGES_MODE,
  LOCAL_COMPARISON_CODEC,
  LOCAL_COMPARISON_ENGINE,
  TRANSPORT,
  canonicalJson,
  capturePageBytes,
  capturePagesDigest,
  capturePageUploads,
  captureRowProfile,
  captureRowView,
  compareCaptureIdentity,
  createCapturePagesReceipt,
  digestJson,
  parseCapturePage,
  parseCapturePageIndex,
  sha256,
  validateCaptureReference,
} from "../src/index.js";
import type {
  CapturePage,
  CapturePageIndex,
  CaptureProfile,
  CaptureRow,
  CaptureRowComparison,
  Json,
} from "../src/index.js";

const digest = (character: string) => character.repeat(64);

function profile(overrides: Partial<CaptureProfile> = {}): CaptureProfile {
  return {
    browser: "chromium",
    browserVersion: "153.0",
    osImageDigest: digest("a"),
    fontsDigest: digest("b"),
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezone: "UTC",
    reducedMotion: "reduce",
    colorScheme: "light",
    contrast: "no-preference",
    forcedColors: "none",
    animationPolicy: "disabled",
    captureOptions: { animations: "disabled", fullPage: false },
    ...overrides,
  };
}

function row(itemKey: string, overrides: Partial<Record<number, unknown>> = {}): CaptureRow {
  const values: unknown[] = [
    itemKey,
    null,
    0,
    0,
    0,
    [0, 16, 316, 80],
    0,
    digest("e"),
    3394,
    316,
    80,
    0,
  ];
  for (const [position, value] of Object.entries(overrides)) {
    values[Number(position)] = value;
  }
  // The tests also build rows that the validator must refuse.
  return values as CaptureRow;
}

function page(rows: CaptureRow[] = [row("dialog/open")]): CapturePage {
  return {
    schemaVersion: "1.0",
    variants: [{ key: "react-light", browser: "chromium", colorScheme: "light" }],
    profiles: [profile()],
    tests: [
      { id: "linux/test-1", file: "dialog.test.ts", titlePath: ["dialog", "open"], retry: 0 },
    ],
    comparisons: [{ threshold: 0.2, maxDiffPixels: 0 }],
    rows,
  };
}

const compared: CaptureRowComparison = {
  reference: digest("f"),
  outcome: "changed",
  changedPixels: 137,
  ratio: 0.5,
  sizeChanged: false,
  mask: { digest: digest("1"), bytes: 2048, width: 316, height: 80 },
};

function index(overrides: Partial<CapturePageIndex> = {}): CapturePageIndex {
  return {
    schemaVersion: "1.0",
    producer: {
      name: "@visonaut/playwright",
      version: "0.2.0",
      nodeVersion: "24.18.0",
      playwrightVersion: "1.63.0",
    },
    job: { id: "789", attempt: 2 },
    comparison: { engineVersion: LOCAL_COMPARISON_ENGINE, codecVersion: LOCAL_COMPARISON_CODEC },
    reference: { snapshotId: "snapshot-1", baselineRevision: 4, digest: digest("9") },
    sources: [
      {
        shardKey: "linux",
        workflowAttempt: 1,
        jobId: "12",
        jobName: "capture (linux)",
        manifestDigest: digest("2"),
        artifactId: "34",
        artifactName: "visonaut-capture-456-1-linux",
      },
    ],
    pages: [
      { digest: digest("3"), last: ["dialog/open", "react-light"] },
      { digest: digest("4"), last: ["menu/open", "react-dark"] },
    ],
    ...overrides,
  };
}

const limits = { maximumPages: 10, maximumSources: 16 };

describe("a capture page", () => {
  it("accepts a page and returns the same object", () => {
    const value = page([
      row("dialog/open"),
      row("dialog/open-2", { 1: "Open dialog", 11: 1 }),
      row("menu/open", { 11: compared }),
    ]);
    expect(parseCapturePage(value)).toBe(value);
  });

  it("accepts 2,000 rows and refuses 2,001 and 0", () => {
    const rows = (count: number) =>
      Array.from({ length: count }, (_, position) =>
        row(`item-${String(position).padStart(5, "0")}`),
      );
    expect(parseCapturePage(page(rows(CAPTURE_PAGE_ROWS))).rows).toHaveLength(2000);
    expect(() => parseCapturePage(page(rows(CAPTURE_PAGE_ROWS + 1)))).toThrow(
      "rows must be an array",
    );
    expect(() => parseCapturePage(page([]))).toThrow("rows must be an array");
  });

  it("refuses a row that does not have 12 positions", () => {
    const short = row("dialog/open").slice(0, 11);
    const long = [...row("dialog/open"), 0];
    for (const value of [short, long, { 0: "dialog/open" }, null]) {
      // The validator must refuse a value that is not a row.
      expect(() => parseCapturePage(page([value as CaptureRow]))).toThrow("12 positions");
    }
  });

  it.each([
    ["an item key above 256 characters", { 0: "k".repeat(257) }, "itemKey"],
    ["an item key with a traversal segment", { 0: "dialog/../open" }, "itemKey"],
    ["a name above 1,024 characters", { 1: "n".repeat(1025) }, "name"],
    ["an empty name", { 1: "" }, "name"],
    ["a name with a control character", { 1: "Open\ndialog" }, "name"],
    ["a name that repeats the item key", { 1: "dialog/open" }, "must be null"],
    ["a variant position that is no integer", { 2: 0.5 }, "row variant"],
    ["a variant position after the list", { 2: 1 }, "row variant"],
    ["a negative test position", { 3: -1 }, "row test"],
    ["a profile position after the list", { 4: 1 }, "row profile"],
    ["a comparison position after the list", { 6: 1 }, "row comparison"],
    ["a clip with 3 numbers", { 5: [0, 16, 316] }, "row clip"],
    ["a clip with 5 numbers", { 5: [0, 16, 316, 80, 1] }, "row clip"],
    ["a clip that is an object", { 5: { x: 0, y: 16, width: 316, height: 80 } }, "row clip"],
    ["a clip with a number that is not finite", { 5: [0, 16, Infinity, 80] }, "finite numbers"],
    ["an image digest with a wrong form", { 7: "E".repeat(64) }, "image digest"],
    ["an image with 0 bytes", { 8: 0 }, "image bytes"],
    ["an image above 20 MiB", { 8: 20 * 1024 * 1024 + 1 }, "image bytes"],
    ["an image width of 0", { 9: 0 }, "image width"],
    ["an image width above 100,000", { 9: 100_001 }, "image width"],
    ["an image height above 100,000", { 10: 100_001 }, "image height"],
    ["a result that is another number", { 11: 2 }, "row result"],
    ["a result that is a text", { 11: "unchanged" }, "row result"],
    [
      "a compared result with the bytes of its reference",
      { 11: { ...compared, reference: digest("e") } },
      "bytes of its reference",
    ],
    ["a compared result with no reference", { 11: { ...compared, reference: null } }, "digest"],
    ["an unknown outcome", { 11: { ...compared, outcome: "approved" } }, "row outcome"],
    [
      "more changed pixels than the image has",
      { 11: { ...compared, changedPixels: 316 * 80 + 1 } },
      "changedPixels",
    ],
    ["a ratio above 1", { 11: { ...compared, ratio: 1.01 } }, "Row ratio"],
    ["a size flag that is no boolean", { 11: { ...compared, sizeChanged: 0 } }, "sizeChanged"],
    [
      "a mask on an unchanged capture",
      { 11: { ...compared, outcome: "unchanged" } },
      "Only a changed capture",
    ],
    [
      "a mask above 20 MiB",
      { 11: { ...compared, mask: { ...compared.mask, bytes: 20 * 1024 * 1024 + 1 } } },
      "mask bytes",
    ],
    [
      "a mask width above 100,000",
      { 11: { ...compared, mask: { ...compared.mask, width: 100_001 } } },
      "mask width",
    ],
    [
      "a mask height of 0",
      { 11: { ...compared, mask: { ...compared.mask, height: 0 } } },
      "mask height",
    ],
    [
      "a mask height above 100,000",
      { 11: { ...compared, mask: { ...compared.mask, height: 100_001 } } },
      "mask height",
    ],
    [
      "a mask with no width",
      { 11: { ...compared, mask: { digest: digest("1"), bytes: 1, height: 1 } } },
      "Missing width",
    ],
  ])("refuses %s", (_name, overrides, message) => {
    expect(() => parseCapturePage(page([row("dialog/open", overrides)]))).toThrow(message);
  });

  it("accepts each field at its bound", () => {
    const value = page([
      row("k".repeat(256), {
        1: "n".repeat(1024),
        8: 20 * 1024 * 1024,
        9: 100_000,
        10: 100_000,
        11: { ...compared, changedPixels: 100_000 * 100_000, ratio: 1 },
      }),
    ]);
    expect(parseCapturePage(value)).toBe(value);
  });

  it("refuses rows that do not increase by the item key and then the variant key", () => {
    const variants: CapturePage["variants"] = [
      { key: "react-light", browser: "chromium" },
      { key: "react-dark", browser: "chromium" },
    ];
    const withRows = (rows: CaptureRow[]) => ({ ...page(rows), variants });
    // The variant key gives the order, not the position of the variant in the list.
    expect(() =>
      parseCapturePage(withRows([row("dialog/open"), row("dialog/open", { 2: 1 })])),
    ).toThrow("must increase");
    expect(() =>
      parseCapturePage(withRows([row("menu/open"), row("dialog/open", { 2: 1 })])),
    ).toThrow("must increase");
    // Two rows with the same identity are not an increase.
    expect(() =>
      parseCapturePage(page([row("dialog/open"), row("dialog/open", { 7: digest("d") })])),
    ).toThrow("must increase");
    const sorted = withRows([row("dialog/open"), row("dialog/opened", { 2: 1 }), row("menu/open")]);
    expect(parseCapturePage(sorted)).toBe(sorted);
    // One variant key can have two contents. The key alone gives the order.
    const twoContents = {
      ...page([row("dialog/open"), row("menu/open", { 2: 1 })]),
      variants: [
        { key: "react-light", browser: "chromium" as const },
        { key: "react-light", browser: "chromium" as const, framework: "react" },
      ],
    };
    expect(parseCapturePage(twoContents)).toBe(twoContents);
    twoContents.rows = [row("dialog/open"), row("dialog/open", { 2: 1 })];
    expect(() => parseCapturePage(twoContents)).toThrow("must increase");
    const sameItem = {
      ...page([row("dialog/open"), row("dialog/open", { 2: 1 })]),
      variants: [variants[1], variants[0]],
    };
    expect(parseCapturePage(sameItem)).toBe(sameItem);
  });

  it("orders keys by code unit, as the byte order of the stored keys", () => {
    expect(compareCaptureIdentity(["a", "b"], ["a", "b"])).toBe(0);
    expect(compareCaptureIdentity(["Z", "b"], ["a", "a"])).toBe(-1);
    expect(compareCaptureIdentity(["a", "b"], ["a", "B"])).toBe(1);
    expect(compareCaptureIdentity(["a-b", "x"], ["a/b", "x"])).toBe(-1);
    expect(compareCaptureIdentity(["a", "x"], ["a/b", "x"])).toBe(-1);
  });

  it("refuses a shared list that is not in the order of first use", () => {
    const value = page([row("dialog/open", { 3: 0 }), row("menu/open", { 3: 1 })]);
    const [first] = value.tests;
    if (!first) {
      throw new Error("The fixture has no test.");
    }
    value.tests = [{ ...first, id: "linux/test-2" }, first];
    expect(parseCapturePage(value)).toBe(value);
    // The first row cannot use the second entry before a row uses the first one.
    value.rows = [row("dialog/open", { 3: 1 }), row("menu/open", { 3: 0 })];
    expect(() => parseCapturePage(value)).toThrow("row test");
  });

  it.each(["variants", "profiles", "tests", "comparisons"] as const)(
    "refuses an entry of %s that no row uses, and an entry that is there two times",
    (key) => {
      const unused = page();
      const changes = {
        variants: { key: "react-dark", browser: "chromium" },
        profiles: profile({ locale: "pt-BR" }),
        tests: { id: "linux/test-2", file: "menu.test.ts", titlePath: ["menu"], retry: 0 },
        comparisons: { threshold: 0.1 },
      };
      Object.assign(unused, { [key]: [...unused[key], changes[key]] });
      expect(() => parseCapturePage(unused)).toThrow(`${key} must be an array`);
      const position = { variants: 2, profiles: 4, tests: 3, comparisons: 6 }[key];
      const twoRows = page([row("dialog/open"), row("menu/open", { [position]: 1 })]);
      Object.assign(twoRows, { [key]: [...twoRows[key], changes[key]] });
      expect(parseCapturePage(twoRows)).toBe(twoRows);
      const repeated = page([row("dialog/open"), row("menu/open", { [position]: 1 })]);
      Object.assign(repeated, { [key]: [...repeated[key], structuredClone(repeated[key][0])] });
      expect(() => parseCapturePage(repeated)).toThrow(`Duplicate page ${key} entry`);
      const stillUnused = page([row("dialog/open"), row("menu/open")]);
      Object.assign(stillUnused, { [key]: [...stillUnused[key], changes[key]] });
      expect(() => parseCapturePage(stillUnused)).toThrow("must be used by a row");
    },
  );

  it("refuses an empty shared list and a wrong schema version", () => {
    for (const key of ["variants", "profiles", "tests", "comparisons"] as const) {
      expect(() => parseCapturePage({ ...page(), [key]: [] })).toThrow(`${key} must be an array`);
    }
    expect(() => parseCapturePage({ ...page(), schemaVersion: "2.0" })).toThrow(
      "Unsupported schemaVersion",
    );
    const { rows: _rows, ...noRows } = page();
    expect(() => parseCapturePage(noRows)).toThrow("Missing rows");
    expect(() => parseCapturePage([page()])).toThrow("must be an object");
  });

  it("refuses shared entries above their bounds", () => {
    const [test] = page().tests;
    if (!test) {
      throw new Error("The fixture has no test.");
    }
    const titles = (count: number) => Array.from({ length: count }, () => "t".repeat(1024));
    const withTest = (titlePath: string[]) => ({ ...page(), tests: [{ ...test, titlePath }] });
    expect(parseCapturePage(withTest(titles(100))).tests).toHaveLength(1);
    expect(() => parseCapturePage(withTest(titles(101)))).toThrow("titlePath");
    expect(() => parseCapturePage(withTest(["t".repeat(1025)]))).toThrow("title");
    expect(() =>
      parseCapturePage({ ...page(), tests: [{ ...test, id: "i".repeat(1025) }] }),
    ).toThrow("id");
    expect(
      parseCapturePage({ ...page(), tests: [{ ...test, file: "f".repeat(1024) }] }).tests,
    ).toHaveLength(1);
    expect(() =>
      parseCapturePage({ ...page(), tests: [{ ...test, file: "f".repeat(1025) }] }),
    ).toThrow("test.file");
    expect(() =>
      parseCapturePage({ ...page(), tests: [{ ...test, status: "passed", retry: -1 }] }),
    ).toThrow("retry");
    expect(() =>
      parseCapturePage({ ...page(), variants: [{ key: "k".repeat(257), browser: "chromium" }] }),
    ).toThrow("variant.key");
    expect(() => parseCapturePage({ ...page(), comparisons: [{ threshold: 1.5 }] })).toThrow(
      "threshold",
    );
    expect(() =>
      parseCapturePage({ ...page(), profiles: [profile({ deviceScaleFactor: 11 })] }),
    ).toThrow("deviceScaleFactor");
  });

  it("refuses a profile that holds a second clip or comparison settings", () => {
    const clipped = profile({ captureOptions: { clip: { x: 0, y: 0, width: 1, height: 1 } } });
    expect(() => parseCapturePage({ ...page(), profiles: [clipped] })).toThrow(
      "profile without captureOptions.clip",
    );
    // A rectangle that a row can hold must be in the row, so that one capture has one form.
    expect(() =>
      parseCapturePage({ ...page([row("dialog/open", { 5: null })]), profiles: [clipped] }),
    ).toThrow("must be in the row");
    const other = profile({ captureOptions: { clip: { x: 0, y: 0, width: 1 } } });
    const complete = { ...page([row("dialog/open", { 5: null })]), profiles: [other] };
    expect(parseCapturePage(complete)).toBe(complete);
    expect(() => parseCapturePage({ ...page(), profiles: [other] })).toThrow(
      "profile without captureOptions.clip",
    );
    for (const key of ["comparisonPolicyDigest", "comparisonEngineVersion"]) {
      expect(() =>
        parseCapturePage({ ...page(), profiles: [{ ...profile(), [key]: digest("c") }] }),
      ).toThrow("cannot hold comparison settings");
    }
  });

  it("refuses a variant that differs from its profile", () => {
    expect(() =>
      parseCapturePage({ ...page(), variants: [{ key: "react-light", browser: "firefox" }] }),
    ).toThrow("Variant browser");
    expect(() =>
      parseCapturePage({
        ...page(),
        variants: [{ key: "react-light", browser: "chromium", colorScheme: "dark" }],
      }),
    ).toThrow("Variant colorScheme");
  });

  it("gives the same digest for the same captures, and its bytes are canonical JSON", async () => {
    const first = page([row("dialog/open"), row("menu/open", { 11: 1 })]);
    const second = structuredClone(first);
    // Another key order of an object does not change the bytes.
    second.variants = [{ colorScheme: "light", browser: "chromium", key: "react-light" }];
    const bytes = capturePageBytes(first);
    expect(new TextDecoder().decode(bytes)).toBe(canonicalJson(first));
    expect(capturePageBytes(second)).toEqual(bytes);
    expect(await sha256(bytes)).toBe(await digestJson(second));
    const changed = page([row("dialog/open"), row("menu/open")]);
    expect(await digestJson(changed)).not.toBe(await digestJson(first));
  });

  it("refuses a page above 4 MiB", () => {
    expect(CAPTURE_PAGE_MAX_BYTES).toBe(4 * 1024 * 1024);
    const titlePath = Array.from({ length: 100 }, () => "t".repeat(1024));
    const rows = Array.from({ length: 50 }, (_, position) =>
      row(`item-${String(position).padStart(2, "0")}`, { 3: position }),
    );
    const large = page(rows);
    large.tests = rows.map((_, position) => ({
      id: `linux/test-${position}`,
      file: "dialog.test.ts",
      titlePath,
      retry: 0,
    }));
    // Each field is inside its bound, so only the bytes of the page stop it.
    expect(parseCapturePage(large)).toBe(large);
    expect(() => capturePageBytes(large)).toThrow("at most 4194304 bytes");
    large.rows = rows.slice(0, 40);
    large.tests = large.tests.slice(0, 40);
    expect(capturePageBytes(large).byteLength).toBeLessThanOrEqual(CAPTURE_PAGE_MAX_BYTES);
  });

  it("keeps an unchanged capture of a real size below 200 bytes", () => {
    const real = row("ariakit-tailwind-7466/applied-light-week-hover", {
      5: [442.3125, 320, 316, 80],
    });
    expect(JSON.stringify(real).length).toBeLessThan(200);
  });
});

describe("the view of a row", () => {
  it("returns the names, the complete profile, and the digest of the capture job", async () => {
    const original = profile({
      captureOptions: {
        animations: "disabled",
        clip: { x: 442.3125, y: 320, width: 316, height: 80 },
        fullPage: false,
      },
    });
    const split = captureRowProfile(original);
    expect(split.clip).toEqual([442.3125, 320, 316, 80]);
    expect(split.profile.captureOptions).toEqual({ animations: "disabled", fullPage: false });
    const value = page([row("dialog/open", { 1: "Open dialog", 5: split.clip, 11: compared })]);
    value.profiles = [split.profile];
    const [first] = parseCapturePage(value).rows;
    if (!first) {
      throw new Error("The page has no row.");
    }
    expect(await captureRowView(value, first)).toEqual({
      itemKey: "dialog/open",
      variantKey: "react-light",
      name: "Open dialog",
      variant: value.variants[0],
      test: value.tests[0],
      profile: original,
      profileDigest: await digestJson(original),
      comparison: { threshold: 0.2, maxDiffPixels: 0 },
      image: { digest: digest("e"), bytes: 3394, width: 316, height: 80 },
      result: compared,
    });
  });

  it("uses the item key as the name, and the shared profile when the row has no clip", async () => {
    const value = page([row("dialog/open", { 5: null })]);
    const [first] = value.rows;
    if (!first) {
      throw new Error("The page has no row.");
    }
    const view = await captureRowView(value, first);
    expect(view.name).toBe("dialog/open");
    expect(view.profile).toBe(value.profiles[0]);
    expect(view.profileDigest).toBe(await digestJson(profile()));
  });

  it("leaves a clip with another form in the profile", async () => {
    const clips: Json[] = [
      { x: 0, y: 0, width: 1 },
      { x: 0, y: 0, width: 1, height: 1, scale: 2 },
      { x: "0", y: 0, width: 1, height: 1 },
      [0, 0, 1, 1],
      "none",
      null,
    ];
    for (const clip of clips) {
      const original = profile({ captureOptions: { clip } });
      expect(captureRowProfile(original)).toEqual({ profile: original, clip: null });
    }
    const none = profile();
    expect(captureRowProfile(none)).toEqual({ profile: none, clip: null });
  });

  it("refuses a row of another page", async () => {
    await expect(captureRowView(page(), row("dialog/open", { 2: 1 }))).rejects.toThrow(
      "missing shared entry",
    );
  });
});

describe("the images of a page that need an upload", () => {
  it("has each new or changed capture and each mask, and no unchanged capture", () => {
    const { mask: _mask, ...unchangedPixels } = { ...compared, outcome: "unchanged" as const };
    const value = page([
      row("a-same-bytes"),
      row("b-new", { 7: digest("5"), 11: 1 }),
      row("c-changed", { 7: digest("6"), 11: compared }),
      row("d-same-pixels", { 7: digest("7"), 11: unchangedPixels }),
      row("e-new-again", { 7: digest("5"), 11: 1 }),
    ]);
    parseCapturePage(value);
    expect([...capturePageUploads(value)]).toEqual([
      [digest("5"), { digest: digest("5"), bytes: 3394, width: 316, height: 80 }],
      [digest("6"), { digest: digest("6"), bytes: 3394, width: 316, height: 80 }],
      [digest("1"), compared.mask],
    ]);
  });

  it("needs no check of its own, because a page with one digest and two sizes is refused", () => {
    const message = "One image digest of a page has two sizes";
    // Also for an image that needs no upload.
    expect(() => parseCapturePage(page([row("a"), row("b", { 8: 1 })]))).toThrow(message);
    expect(() =>
      parseCapturePage(page([row("a", { 11: 1 }), row("b", { 9: 315, 11: 1 })])),
    ).toThrow(message);
    expect(() => parseCapturePage(page([row("a"), row("b", { 10: 79 })]))).toThrow(message);
    const mask = { ...compared.mask, digest: digest("e"), bytes: 1 };
    expect(() =>
      parseCapturePage(page([row("a"), row("b", { 7: digest("d"), 11: { ...compared, mask } })])),
    ).toThrow(message);
    const same = page([row("a"), row("b"), row("c", { 7: digest("d"), 11: compared })]);
    expect(parseCapturePage(same)).toBe(same);
  });
});

describe("the page index", () => {
  it("accepts an index and returns the same object", () => {
    const value = index();
    expect(parseCapturePageIndex(value, limits)).toBe(value);
    const first = index({ reference: { snapshotId: null, baselineRevision: 0, digest: null } });
    expect(parseCapturePageIndex(first, limits)).toBe(first);
  });

  it("takes the bounds of the two lists that grow with a run from the caller", () => {
    const pages = Array.from({ length: 11 }, (_, position) => ({
      digest: String(position).padStart(64, "0"),
      last: [`item-${String(position).padStart(2, "0")}`, "react-light"] as [string, string],
    }));
    expect(() => parseCapturePageIndex(index({ pages }), limits)).toThrow("pages must be an array");
    expect(
      parseCapturePageIndex(index({ pages }), { ...limits, maximumPages: 11 }).pages,
    ).toHaveLength(11);
    const [source] = index().sources;
    if (!source) {
      throw new Error("The fixture has no source.");
    }
    const sources = Array.from({ length: 17 }, (_, position) => ({
      ...source,
      shardKey: `linux-${position}`,
    }));
    expect(() => parseCapturePageIndex(index({ sources }), limits)).toThrow(
      "sources must be an array",
    );
    expect(
      parseCapturePageIndex(index({ sources }), { ...limits, maximumSources: 17 }).sources,
    ).toHaveLength(17);
    expect(() => parseCapturePageIndex(index({ pages: [] }), limits)).toThrow(
      "pages must be an array",
    );
    expect(() => parseCapturePageIndex(index({ sources: [] }), limits)).toThrow(
      "sources must be an array",
    );
  });

  it.each([0, -1, 1.5, Infinity, Number.NaN])("refuses the limit %s", (limit) => {
    expect(() => parseCapturePageIndex(index(), { ...limits, maximumPages: limit })).toThrow(
      TypeError,
    );
    expect(() => parseCapturePageIndex(index(), { ...limits, maximumSources: limit })).toThrow(
      TypeError,
    );
  });

  it("has no constant that limits a run: 300,000 captures are 150 entries and few bytes", async () => {
    const pages = Array.from({ length: 150 }, (_, position) => ({
      digest: String(position).padStart(64, "0"),
      last: [
        `ariakit-ui-item-${String(position).padStart(4, "0")}/page/custom-color`,
        "react-firefox-desktop-light-light-no-preference-none",
      ] as [string, string],
    }));
    const [source] = index().sources;
    if (!source) {
      throw new Error("The fixture has no source.");
    }
    const sources = Array.from({ length: 76 }, (_, position) => ({
      ...source,
      shardKey: `linux-${position}`,
    }));
    const large = index({ pages, sources });
    expect(parseCapturePageIndex(large, { maximumPages: 150, maximumSources: 76 })).toBe(large);
    expect(canonicalJson(large).length).toBeLessThan(64 * 1024);
    expect(Object.keys(large)).not.toContain("captures");
  });

  it("refuses page entries that do not increase", () => {
    const [first, second] = index().pages;
    if (!first || !second) {
      throw new Error("The fixture has no pages.");
    }
    expect(() => parseCapturePageIndex(index({ pages: [second, first] }), limits)).toThrow(
      "must increase",
    );
    expect(() =>
      parseCapturePageIndex(index({ pages: [first, { ...second, last: first.last }] }), limits),
    ).toThrow("must increase");
    expect(() =>
      parseCapturePageIndex(index({ pages: [first, { ...second, digest: first.digest }] }), limits),
    ).toThrow("Duplicate page digest");
  });

  it.each([
    [
      "a page digest with a wrong form",
      { pages: [{ digest: "3".repeat(63), last: ["a", "b"] }] },
      "digest",
    ],
    [
      "a page entry with one key",
      { pages: [{ digest: digest("3"), last: ["a"] }] },
      "last item key",
    ],
    [
      "a page entry with a long item key",
      { pages: [{ digest: digest("3"), last: ["k".repeat(257), "b"] }] },
      "last itemKey",
    ],
    [
      "a page entry with a long key",
      { pages: [{ digest: digest("3"), last: ["a", "k".repeat(257)] }] },
      "last variantKey",
    ],
    ["a job ID that is no decimal ID", { job: { id: "pending", attempt: 2 } }, "job.id"],
    ["a job attempt of 0", { job: { id: "789", attempt: 0 } }, "job.attempt"],
    [
      "a capture source of a later attempt",
      { job: { id: "789", attempt: 1 }, sources: [{ ...index().sources[0], workflowAttempt: 2 }] },
      "later workflow attempt",
    ],
    [
      "two capture sources with one shard key",
      { sources: [index().sources[0], index().sources[0]] },
      "Duplicate capture source shard",
    ],
    [
      "a capture source with a long job name",
      { sources: [{ ...index().sources[0], jobName: "j".repeat(257) }] },
      "jobName",
    ],
    [
      "another comparison engine",
      { comparison: { engineVersion: "other", codecVersion: LOCAL_COMPARISON_CODEC } },
      "local engine",
    ],
    [
      "another codec",
      { comparison: { engineVersion: LOCAL_COMPARISON_ENGINE, codecVersion: "other" } },
      "local codec",
    ],
    [
      "a reference identity with a wrong form",
      { reference: { snapshotId: null, baselineRevision: 0, digest: "9" } },
      "reference digest",
    ],
    [
      "a snapshot ID above 256 characters",
      { reference: { snapshotId: "s".repeat(257), baselineRevision: 0, digest: null } },
      "snapshotId",
    ],
    [
      "a producer text above 1,024 characters",
      { producer: { ...index().producer, version: "v".repeat(1025) } },
      "producer.version",
    ],
    ["a schema version of another major", { schemaVersion: "2.0" }, "Unsupported schemaVersion"],
  ])("refuses %s", (_name, overrides, message) => {
    // The validator must refuse values that the type does not permit.
    expect(() =>
      parseCapturePageIndex(index(overrides as Partial<CapturePageIndex>), limits),
    ).toThrow(message);
  });

  it("has a manifest digest that is a digest of the page digests in their order", async () => {
    const value = index();
    const manifestDigest = await capturePagesDigest(value);
    expect(manifestDigest).toBe(await digestJson(value));
    const [first, second] = value.pages;
    if (!first || !second) {
      throw new Error("The fixture has no pages.");
    }
    const otherPage = index({ pages: [first, { ...second, digest: digest("5") }] });
    expect(await capturePagesDigest(otherPage)).not.toBe(manifestDigest);
    const otherOrder = index({
      pages: [
        { ...first, digest: second.digest },
        { ...second, digest: first.digest },
      ],
    });
    expect(await capturePagesDigest(otherOrder)).not.toBe(manifestDigest);
    const otherJob = index({ job: { id: "790", attempt: 2 } });
    expect(await capturePagesDigest(otherJob)).not.toBe(manifestDigest);
    expect(await capturePagesDigest(structuredClone(value))).toBe(manifestDigest);
  });

  it("names the receipt artifact by the manifest digest, with a content of a fixed size", async () => {
    const value = index();
    const manifestDigest = await capturePagesDigest(value);
    expect(
      await createCapturePagesReceipt({
        index: value,
        workflowRunId: "456",
        testedSha: "d".repeat(40),
        shardKey: "combined",
      }),
    ).toEqual({
      schemaVersion: "1.0",
      artifactName: `visonaut-discovery-2-789-combined-${manifestDigest}`,
      manifestDigest,
      workflowRunId: "456",
      workflowAttempt: 2,
      testedSha: "d".repeat(40),
      jobId: "789",
      shardKey: "combined",
    });
  });
});

describe("the reference of a reserve answer", () => {
  it("accepts a reference with pages, and no reference with no page", () => {
    expect(() =>
      validateCaptureReference({
        snapshotId: "s",
        baselineRevision: 1,
        digest: digest("9"),
        pages: 150,
      }),
    ).not.toThrow();
    expect(() =>
      validateCaptureReference({ snapshotId: null, baselineRevision: 0, digest: null, pages: 0 }),
    ).not.toThrow();
    // No constant bounds the page count of a reference.
    expect(() =>
      validateCaptureReference({
        snapshotId: "s",
        baselineRevision: 1,
        digest: digest("9"),
        pages: 1_000_000,
      }),
    ).not.toThrow();
  });

  it.each([
    [{ snapshotId: "s", baselineRevision: 1, digest: digest("9"), pages: 0 }, "no reference page"],
    [{ snapshotId: null, baselineRevision: 0, digest: null, pages: 1 }, "no reference page"],
    [{ snapshotId: "s", baselineRevision: 1, digest: digest("9"), pages: 1.5 }, "reference pages"],
    [{ snapshotId: "s", baselineRevision: 1, digest: digest("9") }, "Missing pages"],
    [{ snapshotId: "s", baselineRevision: -1, digest: digest("9"), pages: 1 }, "baselineRevision"],
    [{ baselineRevision: 1, digest: digest("9"), pages: 1 }, "Missing snapshotId"],
  ])("refuses %j", (value, message) => {
    expect(() => validateCaptureReference(value)).toThrow(message);
  });
});

it("gives the paths of the page requests", () => {
  expect(CAPTURE_PAGES_MODE).toBe("local-pages-v1");
  expect(TRANSPORT.referencePage("run 1", digest("9"), 3)).toBe(
    `/v1/runs/run%201/reference/${digest("9")}/pages/3`,
  );
  expect(TRANSPORT.referenceImage("run 1", digest("e"))).toBe(
    `/v1/runs/run%201/reference/images/${digest("e")}`,
  );
  expect(TRANSPORT.page("run 1")).toBe("/v1/runs/run%201/pages");
  expect(TRANSPORT.pageIndex("run 1")).toBe("/v1/runs/run%201/index");
});
