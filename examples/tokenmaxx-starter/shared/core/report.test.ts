import { styleText } from "node:util";

import { describe, expect, it } from "vitest";

import {
  asSentence,
  colorFor,
  exerciseOrder,
  nextAfter,
  reporter,
  sentence,
  shortPath,
  takeDetails,
  wrap,
} from "./report.ts";

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
  it("prints one line per check, a FAIL's detail always, the count, the next step and how to see the rest", async () => {
    const { r, lines, written } = capture(false);
    r.header("checking ~/app");
    expect(await r.during("Waiting on something slow...", () => 7)).toBe(7);
    r.check("PASS", "It passes.", "a long sentence about why");
    r.check("FAIL", "It fails.", "what went wrong\nrun pnpm ex 09.9 setup");
    r.check("NOTE", "A note isn't there yet.", "more about the note");
    r.check("STRETCH", "A stretch holds.");
    r.notDone();
    expect(lines).toEqual([
      "09.9 · A title · checking ~/app",
      "PASS     It passes.",
      "FAIL     It fails.",
      "         What went wrong.",
      "         Run pnpm ex 09.9 setup.",
      "",
      "Not required for this step:",
      "NOTE     A note isn't there yet.",
      "STRETCH  A stretch holds.",
      "",
      "Not done yet: 1 of 2 checks pass.",
      "Next: paste the FAIL lines into Pi and ask it to fix them, then run this again.",
      "More: pnpm ex 09.9 done --details",
    ]);
    expect(written).toEqual([]);
  });

  it("prints every detail with --details, the next exercise, and no More line", () => {
    const { r, lines } = capture(true);
    r.check("PASS", "It passes.", "why it passes");
    r.done("Done.", nextAfter("02.2"));
    expect(lines).toEqual([
      "PASS     It passes.",
      "         Why it passes.",
      "",
      "Done.",
      "Next: 03.1 · Yesterday's mistake. Start it with: pnpm ex 03.1 setup",
    ]);
    expect(nextAfter("06.1")).toBe("nothing. That was the last exercise.");
    const far = capture(false);
    far.r.done("Done.", nextAfter("01.1", "your tokenmaxx folder"));
    // Past 80 columns, the command goes on a line of its own, whole.
    expect(far.lines.slice(-2)).toEqual([
      "Next: 02.1 · Wake me when it's done, in your tokenmaxx folder:",
      "      pnpm ex 02.1 setup",
    ]);
    expect(exerciseOrder.map(([id]) => id)).toEqual([
      "00.1",
      "01.1",
      "02.1",
      "02.2",
      "03.1",
      "04.1",
      "05.1",
      "06.1",
    ]);
  });

  it("gives the FAILs' one shared fix as the next step", () => {
    const { r, lines } = capture(false);
    r.check("PASS", "It passes.");
    r.check("FAIL", "It isn't committed.", "a.ts", "commit it.");
    r.notDone();
    expect(lines.slice(-2)).toEqual([
      "Not done yet: 1 of 2 checks pass.",
      "Next: commit it.",
    ]);
    const two = capture(false);
    two.r.check("FAIL", "One.", "", "commit it.");
    two.r.check("FAIL", "Two.");
    two.r.notDone({ words: "Not ready yet", otherwise: "fix both." });
    expect(two.lines.slice(-2)).toEqual([
      "Not ready yet: 0 of 2 checks pass.",
      "Next: fix both.",
    ]);
  });

  it("says not started in one line, under the list when there is one", () => {
    const { r, lines } = capture(false);
    r.header();
    r.line("");
    r.notStarted("pnpm ex 09.9 setup");
    expect(lines).toEqual([
      "09.9 · A title",
      "",
      "Not started. Start it with: pnpm ex 09.9 setup",
    ]);
    const all = capture(true);
    all.r.check("FAIL", "It fails.", "no run yet");
    all.r.notStarted("pnpm ex 09.9 setup");
    expect(all.lines.slice(-2)).toEqual([
      "",
      "Not started. Start it with: pnpm ex 09.9 setup",
    ]);
  });

  it("wraps a long sentence to 80 columns, under its text", () => {
    const { r, lines } = capture(false);
    const long =
      "A message from that session to nobody-here, a name nobody has, failed where it could see it.";
    r.check("PASS", long);
    expect(lines).toEqual([
      "PASS     A message from that session to nobody-here, a name nobody has, failed",
      "         where it could see it.",
    ]);
    expect(lines.every((l) => l.length <= 80)).toBe(true);
    expect(wrap("one two", 80, "  ")).toEqual(["one two"]);
    // A command's first two words stay together.
    expect(wrap("start it with pnpm pi now", 18, "")).toEqual([
      "start it with",
      "pnpm pi now",
    ]);
  });

  it("makes a detail line a sentence, but leaves names and paths alone", () => {
    expect(asSentence("no run yet")).toBe("No run yet.");
    expect(asSentence("run_abc is still running")).toBe(
      "run_abc is still running."
    );
    expect(asSentence("copy /tmp/x")).toBe("Copy /tmp/x");
    expect(asSentence("It said: done.")).toBe("It said: done.");
    expect(asSentence("tmx-05.1-kiwi is gone")).toBe("tmx-05.1-kiwi is gone.");
    expect(asSentence("see the job. (a.ts has a type error.)")).toBe(
      "See the job. (a.ts has a type error.)"
    );
  });

  it("leaves out a detail line its sentence already says, but keeps a short one", () => {
    const { r, lines } = capture(false);
    r.check(
      "FAIL",
      "There's no consume in a later session to check yet.",
      "no consume in a later session to check yet\nres_1 is the result"
    );
    r.check("PASS", "It's committed.", "committed");
    expect(lines).toEqual([
      "FAIL     There's no consume in a later session to check yet.",
      "         res_1 is the result.",
      "PASS     It's committed.",
    ]);
    r.notDone();
    expect(lines.at(-1)).toBe("More: pnpm ex 09.9 done --details");
  });

  it("finds a check's sentence by its name, and keeps an unknown name", () => {
    const table = { "a thing": { yes: "It holds.", no: "It doesn't." } };
    expect(sentence(table, "a thing", true)).toBe("It holds.");
    expect(sentence(table, "a thing", false)).toBe("It doesn't.");
    expect(sentence(table, "other", false)).toBe("other");
  });

  it("colors on a terminal and shows a progress line only while its step runs", async () => {
    const { r, lines, written } = capture(false, true);
    await r.during("Waiting...", () => {
      expect(written.join("")).toContain("Waiting...");
    });
    expect(written.at(-1)).toBe("\r\u001b[2K");
    r.check("PASS", "It passes.");
    expect(lines[0]).toBe(
      `${styleText("green", "PASS     ", { validateStream: false })}It passes.`
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
