import { styleText } from "node:util";

import { describe, expect, it } from "vitest";

import { colorFor, reporter, shortPath, takeDetails } from "./report.ts";

function capture(details: boolean, color = false) {
  const lines: string[] = [];
  const written: string[] = [];
  const r = reporter((line) => lines.push(line), {
    id: "09.9",
    title: "A title",
    command: "pnpm ex 09.9 done --details",
    details,
    color,
    write: (text) => written.push(text),
  });
  return { r, lines, written };
}

describe("the check report", () => {
  it("prints one line per passing check, a FAIL's detail always, and how to see the rest", async () => {
    const { r, lines, written } = capture(false);
    r.header("checking ~/app");
    expect(await r.during("Waiting on something slow...", () => 7)).toBe(7);
    r.check("PASS", "it passes", "a long sentence about why");
    r.check("NOTE", "a note: no", "more about the note");
    r.check("FAIL", "it fails", "what went wrong\nand the next step");
    r.check("STRETCH", "a stretch: held");
    r.verdict("Not done yet.");
    expect(lines).toEqual([
      "09.9 · A title · checking ~/app",
      "PASS     it passes",
      "NOTE     a note: no",
      "FAIL     it fails",
      "         what went wrong",
      "         and the next step",
      "STRETCH  a stretch: held",
      "",
      "Not done yet.",
      "More: pnpm ex 09.9 done --details",
    ]);
    expect(written).toEqual([]);
  });

  it("prints every detail with --details, and no More line", () => {
    const { r, lines } = capture(true);
    r.check("PASS", "it passes", "why it passes");
    r.verdict("Done.");
    expect(lines).toEqual([
      "PASS     it passes",
      "         why it passes",
      "",
      "Done.",
    ]);
  });

  it("colors on a terminal and shows a progress line only while its step runs", async () => {
    const { r, lines, written } = capture(false, true);
    await r.during("Waiting...", () => {
      expect(written.join("")).toContain("Waiting...");
    });
    expect(written.at(-1)).toBe("\r\u001b[2K");
    r.check("PASS", "it passes");
    expect(lines[0]).toBe(
      `${styleText("green", "PASS     ", { validateStream: false })}it passes`
    );
  });

  it("clears the progress line when its step throws", async () => {
    const { r, written } = capture(false, true);
    await expect(
      r.during("Waiting...", () => Promise.reject(new Error("boom")))
    ).rejects.toThrow("boom");
    expect(written.at(-1)).toBe("\r\u001b[2K");
  });

  it("puts what it checks on its own line when the header would pass 80 columns", () => {
    const { r, lines } = capture(false);
    const far = `checking ~/${"deep/".repeat(14)}app`;
    r.header(far);
    expect(lines).toEqual(["09.9 · A title", far]);
  });

  it("colors only a terminal without NO_COLOR", () => {
    expect(colorFor({ isTTY: true }, {})).toBe(true);
    expect(colorFor({ isTTY: true }, { NO_COLOR: "1" })).toBe(false);
    expect(colorFor({ isTTY: false }, {})).toBe(false);
    expect(colorFor({}, {})).toBe(false);
  });

  it("takes --details out of the args, and shows home as ~", () => {
    expect(takeDetails(["--details", "pnpm", "x"])).toEqual({
      details: true,
      rest: ["pnpm", "x"],
    });
    expect(takeDetails(["pnpm"])).toEqual({ details: false, rest: ["pnpm"] });
    expect(shortPath("/home/g/app", "/home/g")).toBe("~/app");
    expect(shortPath("/home/gx/app", "/home/g")).toBe("/home/gx/app");
  });
});
