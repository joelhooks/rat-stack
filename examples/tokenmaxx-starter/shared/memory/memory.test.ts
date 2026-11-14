import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { exerciseContext, findRepoRoot } from "#shared/core/context.ts";
import type { SessionRecord } from "#shared/core/sessions.ts";

import { examplePerson, memoryExercise, people, review } from "./exercise.ts";
import { eventsDir, readEvents, ruleSets, type TaskIssued } from "./log.ts";
import {
  follows,
  houseRules,
  mentions,
  ruleById,
  seal,
  unseal,
  usesForm,
} from "./rules.ts";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "tmx-memory-")));
afterAll(() => rmSync(scratch, { recursive: true }));

const priya = { first: "Priya", last: "Nair" };
const task: TaskIssued = {
  _tag: "TaskIssued",
  taskId: "tsk_1",
  service: "invoices",
  release: "3.2.0",
  first: "Priya",
  last: "Nair",
  summary: "fixes rounding on refunds",
  at: "x",
  session: null,
};
const line = (who: string) =>
  `invoices 3.2.0: fixes rounding on refunds (${who})`;

describe("the house rules", () => {
  it("are broken by the name as the task gives it", () => {
    for (const rule of houseRules) {
      expect(follows(rule, line("Priya Nair"), priya)).toBe(false);
      expect(follows(rule, "Priya shipped invoices 3.2.0", priya)).toBe(false);
    }
  });

  it("exclude each other: following one breaks every other, for every name", () => {
    const names = [priya, examplePerson, { first: "Dev", last: "Kowalski" }];
    for (const person of names) {
      for (const rule of houseRules) {
        const entry = line(rule.form(person));
        expect(follows(rule, entry, person), `${rule.id} ${entry}`).toBe(true);
        for (const other of houseRules.filter((r) => r !== rule)) {
          expect(follows(other, entry, person), `${other.id} ${entry}`).toBe(
            false
          );
          expect(usesForm(other, entry, person), `${other.id} ${entry}`).toBe(
            false
          );
        }
      }
    }
  });

  it("refuse a second form of the name next to the right one", () => {
    expect(follows(ruleById("handle"), line("@pnair, PN"), priya)).toBe(false);
    expect(follows(ruleById("initials"), line("PN, Priya Nair"), priya)).toBe(
      false
    );
    expect(usesForm(ruleById("initials"), line("@pnair (PN)"), priya)).toBe(
      true
    );
  });

  it("give nobody initials that spell a word a line might use anyway", () => {
    const words = new Set(
      "AM AN AS AT BE BY DO GO HE IF IN IS IT ME MY NO OF OK ON OR SO TO UP US WE".split(
        " "
      )
    );
    for (const person of [...people, examplePerson]) {
      expect(words.has(ruleById("initials").form(person))).toBe(false);
    }
  });

  it("know a mention in any form, and not a lookalike", () => {
    expect(mentions(line("@pnair"), priya)).toBe(true);
    expect(mentions(line("PN"), priya)).toBe(true);
    expect(mentions(line("the team"), priya)).toBe(false);
    expect(mentions("pn shipped it", priya)).toBe(false);
  });

  it("seal without naming the rule, and unseal to it", () => {
    for (const rule of houseRules) {
      const sealed = seal(rule.id);
      expect(JSON.stringify(sealed)).not.toContain(rule.id);
      expect(unseal(sealed).id).toBe(rule.id);
    }
    expect(() => unseal({ salt: "00", seal: "00" })).toThrow(/setup/);
  });
});

describe("reviewing a hand-in", () => {
  const initials = ruleById("initials");

  it("rejects a missing service, release or person as missing details", () => {
    const r = review("shipped it (PN)", task, initials, []);
    expect(r.verdict).toBe("content");
    expect(r.reasons.join(" ")).toMatch(
      /service \(invoices\) or the release \(3\.2\.0\)/
    );
    expect(
      review("invoices 3.2.0 shipped", task, initials, []).reasons.join(" ")
    ).toMatch(/who shipped it/);
  });

  it("takes the release with or without a v, and not a longer number", () => {
    expect(review("invoices v3.2.0 by PN", task, initials, []).verdict).toBe(
      "accepted"
    );
    expect(review("invoices 3.2.0. By PN", task, initials, []).verdict).toBe(
      "accepted"
    );
    expect(review("invoices 3.2.01 by PN", task, initials, []).verdict).toBe(
      "content"
    );
    expect(review("invoices 13.2.0 by PN", task, initials, []).verdict).toBe(
      "content"
    );
  });

  it("rejects the natural name with the rule and this person as the example", () => {
    const r = review(line("Priya Nair"), task, initials, []);
    expect(r.verdict).toBe("rule");
    expect(r.usedRetired).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/House rule: .*Priya Nair is PN/);
  });

  it("says the old rule changed when the entry uses a retired form", () => {
    const r = review(line("PN"), task, ruleById("handle"), [initials]);
    expect(r.verdict).toBe("rule");
    expect(r.usedRetired).toBe(true);
    expect(r.reasons.join(" ")).toMatch(
      /old house rule, and it changed. Now .*@pnair/
    );
    expect(
      review(line("@pnair"), task, ruleById("handle"), [initials])
    ).toMatchObject({
      verdict: "accepted",
      usedRetired: false,
    });
  });
});

function harness(name: string, records: SessionRecord[] = []) {
  const out: string[] = [];
  let session: string | null = "ses_a";
  let n = 0;
  const randoms = [0.1, 0.7, 0.3, 0.9, 0.5, 0.2, 0.8, 0.4, 0.6];
  const ctx = exerciseContext({
    exerciseId: "03.1",
    repoRoot: findRepoRoot(),
    env: { TMX_STATE_DIR: join(scratch, name) },
  });
  const exercise = memoryExercise(
    { id: "03.1", title: "t" },
    {
      out: (l) => out.push(l),
      err: (l) => out.push(l),
      now: () => new Date(),
      random: () => randoms[n++ % randoms.length] ?? 0,
      session: () => session,
      readSessions: async () => records,
    }
  );
  const run = async (command: string, ...args: string[]) => {
    out.length = 0;
    const fn = exercise.commands[command];
    if (fn === undefined) throw new Error(command);
    const code = await fn(ctx, args);
    return { code, out: [...out], text: out.join("\n") };
  };
  const state = async () => {
    const events = await readEvents(ctx.stateDir);
    const rules = ruleSets(events).map((r) => unseal(r));
    const tasks = events.filter(
      (e): e is TaskIssued => e._tag === "TaskIssued"
    );
    return { events, rules, tasks };
  };
  /** A line for the newest task, written the way `ruleId` says. */
  const entry = async (ruleId: string | "natural") => {
    const t = (await state()).tasks.at(-1);
    if (t === undefined) throw new Error("no task");
    const person = { first: t.first, last: t.last };
    const who =
      ruleId === "natural"
        ? `${t.first} ${t.last}`
        : ruleById(ruleId).form(person);
    return `${who} shipped ${t.service} ${t.release}, which ${t.summary}.`;
  };
  return {
    ctx,
    run,
    state,
    entry,
    as: (s: string | null) => {
      session = s;
    },
  };
}

describe("the memory environment", () => {
  it("rejects the natural line with the reason, then accepts the rule's form", async () => {
    const { run, state, entry } = harness("learn");
    expect((await run("setup")).code).toBe(0);
    expect((await run("task")).text).toMatch(
      /Write one line for the release log: \w+ \w+ shipped/
    );
    const rejected = await run("submit", await entry("natural"));
    expect(rejected.code).toBe(1);
    expect(rejected.text).toMatch(/House rule: people are written/);
    const rule = (await state()).rules[0]?.id ?? "";
    expect((await run("submit", await entry(rule))).code).toBe(0);
    expect((await run("submit", await entry(rule))).text).toMatch(
      /already accepted/
    );
  });

  it("gives each session its own task, and needs one before a hand-in", async () => {
    const { run, as, entry } = harness("per-session");
    await run("setup");
    await run("task");
    const natural = await entry("natural");
    as("ses_b");
    expect((await run("submit", natural)).text).toMatch(
      /No task for this session yet/
    );
    expect((await run("submit")).code).toBe(2);
  });

  it("starts the rule on the first task when setup never ran", async () => {
    const { run, state } = harness("no-setup");
    expect((await run("task")).code).toBe(0);
    expect((await state()).rules).toHaveLength(1);
  });

  it("never says the rule in status, and stores no entry text or reason", async () => {
    const { run, entry, ctx } = harness("quiet");
    await run("setup");
    await run("task");
    const natural = await entry("natural");
    await run("submit", natural);
    const status = (await run("status")).text;
    for (const rule of houseRules) {
      expect(status).not.toContain(rule.says(examplePerson).slice(0, 30));
    }
    expect(status).toMatch(
      /ses_a \(no launcher record\): rejected \(house rule\)/
    );
    expect(status).toMatch(
      /This session: ses_a, not fresh: it has no launcher record/
    );
    const dir = eventsDir(ctx.stateDir);
    const disk = readdirSync(dir)
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n");
    expect(disk).not.toContain(natural);
    expect(disk).not.toMatch(
      /House rule|initials|handle|surname|first-and-initial/
    );
  });

  it("changes to a rule not used before, says the old one is wrong, and catches it", async () => {
    const { run, state, entry } = harness("change");
    await run("setup");
    const changed = await run("change-rule");
    expect(changed.code).toBe(0);
    expect(changed.text).toMatch(/Old, and wrong now: .*\n {2}New: /);
    expect(changed.text).toMatch(/Heads up/);
    const [old, now] = (await state()).rules;
    expect(old?.id).not.toBe(now?.id);
    await run("task");
    const stale = await run("submit", await entry(old?.id ?? ""));
    expect(stale.text).toMatch(/old house rule, and it changed/);
    const last = (await state()).events.at(-1);
    expect(last).toMatchObject({
      _tag: "Submitted",
      usedRetired: true,
      ruleVersion: 2,
    });
    expect((await run("submit", await entry(now?.id ?? ""))).code).toBe(0);
  });

  it("walks the whole story to PASS on every line", async () => {
    const start = Date.now();
    const iso = (ms: number) => new Date(start + ms).toISOString();
    const record = (
      session: string,
      ms: number,
      pi: string
    ): SessionRecord => ({
      session,
      parentSession: null,
      piSessionId: pi,
      pid: 1,
      role: "main",
      exercise: "03.1",
      startedAt: iso(ms),
      endedAt: null,
      ended: null,
      exitCode: null,
      exitSignal: null,
    });
    const records: SessionRecord[] = [];
    const { run, state, entry, as } = harness("story", records);
    records.push(record("ses_a", -1000, "tmx-03.1-main"));
    await run("setup");
    await run("task");
    await run("submit", await entry("natural"));
    const first = (await state()).rules[0]?.id ?? "";
    await run("submit", await entry(first));
    await new Promise((r) => setTimeout(r, 5));
    records.push(record("ses_b", Date.now() - start, "tmx-03.1-main-b"));
    as("ses_b");
    await run("task");
    await run("submit", await entry(first));
    as(null);
    await new Promise((r) => setTimeout(r, 5));
    expect((await run("change-rule")).text).not.toMatch(/Heads up/);
    await new Promise((r) => setTimeout(r, 5));
    records.push(record("ses_c", Date.now() - start, "tmx-03.1-main-c"));
    as("ses_c");
    await run("task");
    const second = (await state()).rules[1]?.id ?? "";
    await run("submit", await entry(second));
    const done = await run("done");
    expect(done.out.filter((l) => l.startsWith("PASS"))).toHaveLength(4);
    expect(done.code).toBe(0);
  });
});
