import { spawn } from "node:child_process";

import { pinnedGitPackages } from "#shared/core/pi-settings.ts";

import { type CheckoutState, checkoutDir, checkoutState } from "./offline.ts";
import { piCliPath } from "./pi.ts";

// Proves a real Pi turn, not just an install. Parses Pi's `--mode json` event
// stream (docs/json.md in the Pi package): it is the documented machine
// interface, it needs no session file, and it carries the tool result and the
// model that answered.

export type PiEvent = {
  readonly type: string;
  readonly [key: string]: unknown;
};

/** One JSON object per LF-terminated line. Non-JSON lines are skipped. */
export function parseEvents(stdout: string): PiEvent[] {
  const events: PiEvent[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.replace(/\r$/, "");
    if (trimmed === "") {
      continue;
    }
    try {
      const value: unknown = JSON.parse(trimmed);
      if (isEvent(value)) {
        events.push(value);
      }
    } catch {
      // stdout is JSONL; anything else is not ours to interpret.
    }
  }
  return events;
}

function isEvent(value: unknown): value is PiEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string"
  );
}

type AssistantMessage = {
  role: "assistant";
  provider?: string;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
  content?: readonly { type: string; text?: string }[];
};

function assistantMessage(event: PiEvent): AssistantMessage | undefined {
  if (event.type !== "message_end") {
    return undefined;
  }
  const message = event["message"];
  if (
    typeof message === "object" &&
    message !== null &&
    "role" in message &&
    message.role === "assistant"
  ) {
    // SAFETY: Pi's message_end carries an AssistantMessage when role is
    // "assistant" (docs/message-types.md); only optional fields are read.
    return message as AssistantMessage;
  }
  return undefined;
}

export type TurnSummary = {
  /** `provider/model` of the last assistant message, if any. */
  readonly model: string | null;
  readonly toolCalls: number;
  readonly toolErrors: number;
  readonly assistantText: string;
  /** The error a failed assistant message reported, if any. */
  readonly modelError: string | null;
  readonly settled: boolean;
};

export function summarize(
  events: readonly PiEvent[],
  toolName?: string
): TurnSummary {
  let model: string | null = null;
  let toolCalls = 0;
  let toolErrors = 0;
  let assistantText = "";
  let modelError: string | null = null;
  let settled = false;
  for (const event of events) {
    if (event.type === "tool_execution_end" && event["toolName"] === toolName) {
      toolCalls += 1;
      if (event["isError"] === true) {
        toolErrors += 1;
      }
    }
    if (event.type === "agent_settled") {
      settled = true;
    }
    const message = assistantMessage(event);
    if (message === undefined) {
      continue;
    }
    if (message.provider !== undefined && message.model !== undefined) {
      model = `${message.provider}/${message.model}`;
    }
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      modelError = message.errorMessage ?? message.stopReason;
    }
    const text = (message.content ?? [])
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("");
    if (text !== "") {
      assistantText = text;
    }
  }
  return { model, toolCalls, toolErrors, assistantText, modelError, settled };
}

export type PiRun = {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
};

/** Runs the pinned Pi once, non-interactively, with JSON output. */
export function runPiJson(
  repoRoot: string,
  args: readonly string[],
  timeoutMs = 300_000
): Promise<PiRun> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      process.execPath,
      [
        piCliPath(repoRoot),
        "--approve",
        "--mode",
        "json",
        "-p",
        "--no-session",
        ...args,
      ],
      { cwd: repoRoot, env: process.env, stdio: ["ignore", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      rejectRun(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveRun({ code, stdout, stderr, timedOut });
    });
  });
}

export type CheckResult = {
  readonly name: string;
  readonly ok: boolean;
  readonly model: string | null;
  readonly detail: string;
  /** What to do next when `ok` is false. */
  readonly next: string | null;
};

/**
 * What a guest does when no model answers. Pi picks whatever default model it
 * found, often one the guest has no plan for, so this names no provider: any
 * provider the guest can use works.
 */
export const loginHint =
  "Run `pnpm pi`, accept project trust, then /login to any provider you can use and /model to pick one of its models. Quit with /quit and rerun this check.";

const looksLoggedOut =
  /not logged in|no models available|no api key|\/login|unauthori[sz]ed|\b401\b/i;

/** The detail for a model error, plus a line when it reads like no login. */
export function explainModelError(error: string): string {
  const shown = `the model returned an error: ${error.slice(0, 300)}`;
  return looksLoggedOut.test(error)
    ? `${shown}. That is the model Pi picked by default; the workshop does not need that provider.`
    : shown;
}

function failedRun(
  name: string,
  run: PiRun,
  summary: TurnSummary
): CheckResult | null {
  if (run.timedOut) {
    return {
      name,
      ok: false,
      model: summary.model,
      detail: "Pi did not finish within the time limit.",
      next: loginHint,
    };
  }
  if (summary.modelError !== null) {
    return {
      name,
      ok: false,
      model: summary.model,
      detail: explainModelError(summary.modelError),
      next: loginHint,
    };
  }
  if (run.code !== 0 || summary.model === null) {
    const tail = run.stderr.trim().split("\n").slice(-3).join(" | ");
    return {
      name,
      ok: false,
      model: summary.model,
      detail: looksLoggedOut.test(tail)
        ? `Pi exited ${run.code} without a model reply: no model is logged in.`
        : `Pi exited ${run.code} without a model reply. ${tail}`.trim(),
      next: loginHint,
    };
  }
  return null;
}

/**
 * One real turn in which the model calls Pi's built-in `read` tool on the
 * repo's package.json and reports the package name it read.
 */
export async function checkPiTurn(
  repoRoot: string,
  runPi: (args: readonly string[]) => Promise<PiRun> = (args) =>
    runPiJson(repoRoot, args)
): Promise<CheckResult> {
  const name = "a model turn with a tool call";
  const run = await runPi([
    "--tools",
    "read",
    "Call the `read` tool exactly once on package.json. Then reply with the value of its `name` field and nothing else.",
  ]);
  const summary = summarize(parseEvents(run.stdout), "read");
  const failed = failedRun(name, run, summary);
  if (failed !== null) {
    return failed;
  }
  if (summary.toolCalls === 0 || summary.toolErrors > 0) {
    return {
      name,
      ok: false,
      model: summary.model,
      detail:
        summary.toolCalls === 0
          ? "the model replied without calling `read`."
          : "`read` ran but returned an error.",
      next: "Rerun once. If it repeats, pick a model that calls tools with /model in `pnpm pi`.",
    };
  }
  if (!summary.assistantText.includes("tokenmaxx-starter")) {
    return {
      name,
      ok: false,
      model: summary.model,
      detail: `the model read package.json but replied "${summary.assistantText.slice(0, 80)}", not its name.`,
      next: "Rerun once. If it repeats, pick a stronger model with /model in `pnpm pi`.",
    };
  }
  return {
    name,
    ok: true,
    model: summary.model,
    detail: "read ran once and the model reported what it read.",
    next: null,
  };
}

/**
 * Every pinned git package in `.pi/settings.json` is on disk at its commit,
 * with its dependencies. Pi installs them on the first trusted start, switched
 * on or not. Nothing here loads one into a Pi session, and nothing prints a
 * package's name.
 */
export function checkPinnedPackage(repoRoot: string): CheckResult {
  const name = "pinned packages installed";
  const pinned = pinnedGitPackages(repoRoot);
  for (const pkg of pinned) {
    const state = checkoutState(checkoutDir(repoRoot, pkg), pkg.commit);
    if (state.kind !== "ready") {
      return notReady(name, pkg.commit, state);
    }
  }
  const commits = pinned.map((pkg) => pkg.commit.slice(0, 7)).join(", ");
  return {
    name,
    ok: true,
    model: null,
    detail:
      pinned.length === 0
        ? "none pinned."
        : `at the pinned commit${pinned.length === 1 ? "" : "s"} ${commits} in .pi/git/.`,
    next: null,
  };
}

function notReady(
  name: string,
  commit: string,
  state: Exclude<CheckoutState, { kind: "ready" }>
): CheckResult {
  return {
    name,
    ok: false,
    model: null,
    detail:
      state.kind === "missing"
        ? "nothing installed in .pi/git/ yet."
        : state.kind === "wrong-commit"
          ? `.pi/git/ holds ${state.commit.slice(0, 7)}, not the pinned ${commit.slice(0, 7)}.`
          : ".pi/git/ has the checkout but no node_modules: its install did not finish.",
    next:
      state.kind === "missing"
        ? "Run `pnpm pi` once and accept project trust: Pi installs them then. Or run `pnpm offline:prepare`."
        : "Delete the .pi/git/ folder, then run `pnpm offline:prepare` to install the pinned commit again.",
  };
}

/** Two Pi processes answering at the same time, as later pieces need. */
export async function checkPiConcurrent(
  repoRoot: string
): Promise<CheckResult> {
  const name = "two Pi sessions at once";
  const tokens = ["PONG-A", "PONG-B"];
  const runs = await Promise.all(
    tokens.map((token) =>
      runPiJson(repoRoot, [
        "--no-tools",
        `Reply with exactly ${token} and nothing else.`,
      ])
    )
  );
  const summaries = runs.map((run) => summarize(parseEvents(run.stdout)));
  for (const [i, run] of runs.entries()) {
    const summary = summaries[i];
    if (summary === undefined) {
      continue;
    }
    const failed = failedRun(name, run, summary);
    if (failed !== null) {
      return { ...failed, detail: `session ${i + 1}: ${failed.detail}` };
    }
    const token = tokens[i] ?? "";
    if (!summary.assistantText.includes(token)) {
      return {
        name,
        ok: false,
        model: summary.model,
        detail: `session ${i + 1} replied "${summary.assistantText.slice(0, 80)}", not ${token}.`,
        next: "Rerun once. A model that cannot follow a one-word instruction will struggle with the later pieces.",
      };
    }
  }
  return {
    name,
    ok: true,
    model: summaries[0]?.model ?? null,
    detail: "both sessions replied.",
    next: null,
  };
}

export function formatResult(result: CheckResult): string[] {
  const lines = [
    `${result.ok ? "PASS" : "FAIL"}  ${result.name}`,
    `      model: ${result.model ?? "(none)"}`,
    `      ${result.detail}`,
  ];
  if (result.next !== null) {
    lines.push(`      next: ${result.next}`);
  }
  return lines;
}
