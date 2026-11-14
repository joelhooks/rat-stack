import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { findRepoRoot } from "#shared/core/context.ts";
import { pinnedGitPackages } from "#shared/core/pi-settings.ts";

import {
  checkPinnedPackage,
  checkPiTurn,
  explainModelError,
  formatResult,
  loginHint,
  parseEvents,
  summarize,
} from "./pi-check.ts";

const assistant = (extra: Record<string, unknown>) =>
  JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      provider: "acme",
      model: "m1",
      stopReason: "stop",
      content: [{ type: "text", text: "DONE" }],
      ...extra,
    },
  });

const stream = [
  JSON.stringify({ type: "session", id: "x" }),
  "not json",
  JSON.stringify({
    type: "tool_execution_end",
    toolName: "until",
    isError: false,
  }),
  JSON.stringify({
    type: "tool_execution_end",
    toolName: "bash",
    isError: true,
  }),
  assistant({}),
  JSON.stringify({ type: "agent_settled", aborted: false }),
  "",
].join("\r\n");

describe("pi json stream", () => {
  it("parses JSONL and skips noise", () => {
    expect(parseEvents(stream).map((e) => e.type)).toEqual([
      "session",
      "tool_execution_end",
      "tool_execution_end",
      "message_end",
      "agent_settled",
    ]);
  });

  it("counts calls to the named tool and reads the model", () => {
    expect(summarize(parseEvents(stream), "until")).toEqual({
      model: "acme/m1",
      toolCalls: 1,
      toolErrors: 0,
      assistantText: "DONE",
      modelError: null,
      settled: true,
    });
  });

  it("reports a model error", () => {
    const failed = summarize(
      parseEvents(
        assistant({ stopReason: "error", errorMessage: "no key", content: [] })
      )
    );
    expect(failed.modelError).toBe("no key");
    expect(failed.toolCalls).toBe(0);
  });
});

describe("check output", () => {
  it("reads every pinned git sha from .pi/settings.json", () => {
    const pinned = pinnedGitPackages(findRepoRoot());
    expect(pinned.length).toBeGreaterThan(0);
    for (const pkg of pinned) {
      expect(pkg.commit).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it("names no provider when no model is logged in", () => {
    expect(loginHint).toContain("/login to any provider you can use");
    expect(loginHint).toMatch(/\/login[^]*\/model/);
    expect(loginHint).not.toMatch(/claude|anthropic|openai|codex|bridge/i);
    const detail = explainModelError("claude-bridge model not logged in");
    expect(detail).toContain("claude-bridge model not logged in");
    expect(detail).toContain("does not need that provider");
    expect(explainModelError("rate limited")).toBe(
      "the model returned an error: rate limited"
    );
  });

  it("fails closed with the provider-neutral login step", async () => {
    const loggedOut = await checkPiTurn("/unused", async () => ({
      code: 1,
      timedOut: false,
      stderr: "",
      stdout: assistant({
        provider: "claude-bridge",
        model: "opus",
        stopReason: "error",
        errorMessage: "claude-bridge model not logged in",
        content: [],
      }),
    }));
    expect(loggedOut.ok).toBe(false);
    expect(loggedOut.next).toBe(loginHint);
    expect(loggedOut.detail).toContain("does not need that provider");

    const noModel = await checkPiTurn("/unused", async () => ({
      code: 1,
      timedOut: false,
      stdout: "",
      stderr:
        "Warning: No models available. Use /login to log into a provider via OAuth or API key. See:\n  /long/node_modules/path/docs/providers.md",
    }));
    expect(noModel.ok).toBe(false);
    expect(noModel.next).toBe(loginHint);
    expect(noModel.detail).toBe(
      "Pi exited 1 without a model reply: no model is logged in."
    );
  });

  it("passes a turn that read package.json and reported its name", async () => {
    const readTurn = [
      JSON.stringify({
        type: "tool_execution_end",
        toolName: "read",
        isError: false,
      }),
      assistant({ content: [{ type: "text", text: "tokenmaxx-starter" }] }),
    ].join("\n");
    const passed = await checkPiTurn("/unused", async () => ({
      code: 0,
      timedOut: false,
      stderr: "",
      stdout: readTurn,
    }));
    expect(passed).toMatchObject({ ok: true, model: "acme/m1" });
  });
});

describe("checkPinnedPackage", () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "tmx-pin-test-")));
  afterAll(() => rmSync(scratch, { recursive: true }));

  it("checks .pi/git at the pinned commit and never prints the name", () => {
    const repo = join(scratch, "repo");
    const checkout = join(
      repo,
      ".pi",
      "git",
      "github.com",
      "joelhooks",
      "pi-until"
    );
    mkdirSync(checkout, { recursive: true });
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: checkout,
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "t",
          GIT_AUTHOR_EMAIL: "t@example.com",
          GIT_COMMITTER_NAME: "t",
          GIT_COMMITTER_EMAIL: "t@example.com",
        },
      }).trim();
    git("init", "-q");
    git("commit", "-q", "--allow-empty", "-m", "one");
    const head = git("rev-parse", "HEAD");
    writeFileSync(
      join(repo, ".pi", "settings.json"),
      JSON.stringify({
        packages: [
          {
            source: `git:github.com/joelhooks/pi-until@${head}`,
            extensions: [],
            skills: [],
            prompts: [],
            themes: [],
          },
          { source: "../catch-up/local-one", extensions: [] },
        ],
      })
    );
    const printed = (r: ReturnType<typeof checkPinnedPackage>) =>
      formatResult(r).join("\n");

    const unfinished = checkPinnedPackage(repo);
    expect(unfinished.ok).toBe(false);
    expect(printed(unfinished)).not.toMatch(/until/i);

    mkdirSync(join(checkout, "node_modules"));
    const ready = checkPinnedPackage(repo);
    expect(ready.ok).toBe(true);
    expect(printed(ready)).not.toMatch(/until/i);
  });
});

describe("formatResult", () => {
  it("prints pass/fail, model and next step", () => {
    expect(
      formatResult({
        name: "n",
        ok: false,
        model: null,
        detail: "d",
        next: "do x",
      })
    ).toEqual([
      "FAIL  n",
      "      model: (none)",
      "      d",
      "      next: do x",
    ]);
  });
});
