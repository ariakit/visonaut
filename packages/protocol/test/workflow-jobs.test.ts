import { expect, it } from "vitest";
import { captureJobNames } from "../src/index.js";

it("binds the complete parenthesized capture job name to its shard", () => {
  const jobs = captureJobNames("App / Visual Capture ({shard})");
  expect(jobs.name("linux")).toBe("App / Visual Capture (linux)");
  expect(jobs.shard("App / Visual Capture (safari)")).toBe("safari");
  expect(jobs.shard("App / Visual Capture (linux")).toBeUndefined();
  expect(jobs.shard("App / Visual Capture (linux) / other")).toBeUndefined();
  expect(jobs.shard("App / Visual Submit")).toBeUndefined();
});

it("keeps literal punctuation and supports other public workflow names", () => {
  const jobs = captureJobNames("Other app / Capture / {shard}");
  expect(jobs.name("linux")).toBe("Other app / Capture / linux");
  expect(jobs.shard("Other app / Capture / safari")).toBe("safari");
  const punctuation = captureJobNames("Capture [.{shard}]");
  expect(punctuation.name("linux")).toBe("Capture [.linux]");
  expect(punctuation.shard("Capture [.linux]")).toBe("linux");
  expect(punctuation.shard("Capture [xlinux]")).toBeUndefined();
});

it.each(["", "Capture", "{shard}", "Capture {shard} {shard}", "Capture\n{shard}"])(
  "rejects an ambiguous or unsafe template: %j",
  (template) => {
    expect(() => captureJobNames(template)).toThrow("one {shard} slot");
  },
);

it.each(["", "../linux", "linux//safari", "linux\n"])(
  "rejects invalid shard keys in both directions: %j",
  (key) => {
    const jobs = captureJobNames("Capture ({shard})");
    expect(() => jobs.name(key)).toThrow();
    expect(() => jobs.shard(`Capture (${key})`)).toThrow();
  },
);

it("bounds rendered names even when the template fits", () => {
  const jobs = captureJobNames(`${"x".repeat(249)}{shard}`);
  expect(jobs.name("linux")).toBe(`${"x".repeat(249)}linux`);
  expect(() => jobs.name("safari12")).toThrow("too long");
});
