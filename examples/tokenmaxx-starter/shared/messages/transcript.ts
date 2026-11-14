import { readdir, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { Env } from "#shared/core/context.ts";

// What a Pi session showed on screen, read back from Pi's own session file
// (`<sessions dir>/<timestamp>_<id>.jsonl`, see Pi's docs/session-format.md).
// The 04.1 check reads it for one thing only: a send to a name nobody has
// came back as a failure the session could see. It keeps the tool calls, the
// tool results, and the messages that reached the session, never the
// assistant's own words: an agent saying "that failed" isn't evidence.

export type TranscriptItem =
  | {
      readonly kind: "call";
      readonly at: string;
      readonly id: string;
      readonly tool: string;
      /** The call's arguments as JSON. */
      readonly args: string;
    }
  | {
      readonly kind: "result";
      readonly at: string;
      readonly callId: string;
      readonly tool: string;
      readonly isError: boolean;
      readonly text: string;
    }
  | {
      /** A message that reached the session: `user` or an extension's `custom`. */
      readonly kind: "message";
      readonly at: string;
      readonly role: "user" | "custom";
      readonly text: string;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function textOf(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) =>
      isRecord(part) && typeof part["text"] === "string" ? part["text"] : ""
    )
    .join("\n");
}

const stamp = (entry: Record<string, unknown>): string | null =>
  typeof entry["timestamp"] === "string" ? entry["timestamp"] : null;

/** The items in one session file's text, oldest first. Bad lines are skipped. */
export function parseTranscript(text: string): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(entry)) {
      continue;
    }
    const at = stamp(entry);
    if (at === null) {
      continue;
    }
    if (entry["type"] === "custom_message") {
      items.push({
        kind: "message",
        at,
        role: "custom",
        text: textOf(entry["content"]),
      });
      continue;
    }
    const message = entry["message"];
    if (entry["type"] !== "message" || !isRecord(message)) {
      continue;
    }
    const role = message["role"];
    if (role === "assistant" && Array.isArray(message["content"])) {
      for (const part of message["content"]) {
        if (
          isRecord(part) &&
          part["type"] === "toolCall" &&
          typeof part["id"] === "string" &&
          typeof part["name"] === "string"
        ) {
          items.push({
            kind: "call",
            at,
            id: part["id"],
            tool: part["name"],
            args: JSON.stringify(part["arguments"] ?? {}),
          });
        }
      }
    } else if (role === "toolResult") {
      items.push({
        kind: "result",
        at,
        callId: String(message["toolCallId"] ?? ""),
        tool: String(message["toolName"] ?? ""),
        isError: message["isError"] === true,
        text: textOf(message["content"]),
      });
    } else if (role === "user" || role === "custom") {
      items.push({
        kind: "message",
        at,
        role,
        text: textOf(message["content"]),
      });
    }
  }
  return items;
}

const expandHome = (path: string) =>
  path === "~"
    ? homedir()
    : path.startsWith("~/")
      ? join(homedir(), path.slice(2))
      : path;

/**
 * Where Pi keeps the sessions of a Pi started in `cwd`, the way Pi works it
 * out: PI_CODING_AGENT_SESSION_DIR, then `sessionDir` in Pi's settings, then
 * `<agent dir>/sessions/--<cwd>--`. A `--session-dir` flag isn't visible from
 * here.
 */
export async function sessionDirFor(cwd: string, env: Env): Promise<string> {
  const fromEnv = env["PI_CODING_AGENT_SESSION_DIR"];
  const agentDir = expandHome(
    env["PI_CODING_AGENT_DIR"] || join(homedir(), ".pi", "agent")
  );
  const fromSettings =
    fromEnv === undefined || fromEnv === ""
      ? (
          await import("@earendil-works/pi-coding-agent")
        ).SettingsManager.create(cwd, agentDir).getSessionDir()
      : fromEnv;
  return fromSettings === undefined || fromSettings === ""
    ? join(
        agentDir,
        "sessions",
        `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`
      )
    : resolve(cwd, expandHome(fromSettings));
}

/**
 * The file holding Pi session `id`, looked for under each folder a Pi could
 * have been started in (the starter, and the guest's repo when the starter
 * sits inside one). Pi names the folder after its own cwd, which is usually
 * the real path but can be the path as given (macOS's `/var` is a symlink to
 * `/private/var`), so both are looked under. Null when there's none.
 */
export async function findTranscript(
  id: string,
  cwds: readonly string[],
  env: Env
): Promise<string | null> {
  const tried = new Set<string>();
  const folders: string[] = [];
  for (const cwd of cwds) {
    folders.push(cwd, await realpath(cwd).catch(() => cwd));
  }
  for (const folder of folders) {
    const dir = await sessionDirFor(folder, env).catch(() => null);
    if (dir === null || tried.has(dir)) {
      continue;
    }
    tried.add(dir);
    const names = await readdir(dir).catch(() => [] as string[]);
    const match = names
      .filter((name) => name.endsWith(`_${id}.jsonl`))
      .toSorted()
      .at(-1);
    if (match !== undefined) {
      return join(dir, match);
    }
  }
  return null;
}

/** Session `id`'s items, or null when Pi has no file for it. */
export async function readTranscript(
  id: string,
  cwds: readonly string[],
  env: Env
): Promise<TranscriptItem[] | null> {
  const path = await findTranscript(id, cwds, env);
  if (path === null) {
    return null;
  }
  return parseTranscript(await readFile(path, "utf8"));
}
