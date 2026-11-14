import { spawn } from "node:child_process";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

import { planLaunch } from "../../scripts/lib/pi.ts";

// What a fresh Pi in this repo actually loads, without a model. The check
// starts a fake OpenAI-compatible endpoint on 127.0.0.1 and a one-shot Pi
// pointed at it (`-e ./probe-provider.ts --model probe/probe -p hi`). Pi's
// first request carries its whole tool list and its system prompt, which
// lists every skill it loaded. The endpoint records that request, answers
// "ok", and Pi exits. Nothing here knows what the guest built or where.

/** Pi's own tools (the pinned Pi's `allToolNames`). Anything else was added. */
export const builtInTools: ReadonlySet<string> = new Set([
  "read",
  "bash",
  "powershell",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
]);

export type LoadedSkill = { readonly name: string; readonly location: string };

/** What one fresh Pi sent on its first request. */
export type ProbeSeen = {
  readonly tools: readonly string[];
  readonly skills: readonly LoadedSkill[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function textOf(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        isRecord(part) && typeof part["text"] === "string" ? part["text"] : ""
      )
      .join("\n");
  }
  return "";
}

const unescapeXml = (text: string) =>
  text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");

/** The skills in a system prompt's `<available_skills>` block. */
export function skillsInPrompt(prompt: string): LoadedSkill[] {
  const block = /<available_skills>([\s\S]*?)<\/available_skills>/.exec(
    prompt
  )?.[1];
  if (block === undefined) {
    return [];
  }
  const skills: LoadedSkill[] = [];
  for (const match of block.matchAll(/<skill>([\s\S]*?)<\/skill>/g)) {
    const body = match[1] ?? "";
    const name = /<name>([\s\S]*?)<\/name>/.exec(body)?.[1];
    const location = /<location>([\s\S]*?)<\/location>/.exec(body)?.[1];
    if (name !== undefined) {
      skills.push({
        name: unescapeXml(name.trim()),
        location: unescapeXml((location ?? "").trim()),
      });
    }
  }
  return skills;
}

/** Reads an OpenAI chat-completions request body as Pi sends it. */
export function seenInRequest(body: unknown): ProbeSeen {
  if (!isRecord(body)) {
    return { tools: [], skills: [] };
  }
  const tools = Array.isArray(body["tools"])
    ? body["tools"].flatMap((tool: unknown) => {
        const fn = isRecord(tool) ? tool["function"] : undefined;
        const name = isRecord(fn) ? fn["name"] : undefined;
        return typeof name === "string" ? [name] : [];
      })
    : [];
  const messages = Array.isArray(body["messages"]) ? body["messages"] : [];
  const prompt = messages
    .filter(
      (m: unknown) =>
        isRecord(m) && (m["role"] === "system" || m["role"] === "developer")
    )
    .map((m: unknown) => (isRecord(m) ? textOf(m["content"]) : ""))
    .join("\n");
  return { tools, skills: skillsInPrompt(prompt) };
}

export const addedTools = (seen: ProbeSeen) =>
  seen.tools.filter((name) => !builtInTools.has(name));

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", rejectBody);
  });
}

const chunk = (delta: object, finish: string | null) =>
  `data: ${JSON.stringify({
    id: "probe",
    object: "chat.completion.chunk",
    created: 0,
    model: "probe",
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...(finish === null
      ? {}
      : {
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
  })}\n\n`;

export type ProbeServer = {
  /** The base URL to give Pi, ending in `/v1`. */
  readonly url: string;
  /** Every parsed request body, in arrival order. */
  readonly requests: readonly unknown[];
  readonly close: () => Promise<void>;
};

/** A fake endpoint on 127.0.0.1 that records requests and answers "ok". */
export async function startProbeServer(): Promise<ProbeServer> {
  const requests: unknown[] = [];
  const server = createServer((req, res) => {
    void (async () => {
      const text = await readBody(req);
      let body: unknown = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      if (req.method !== "POST" || !String(req.url).endsWith("/completions")) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "not found" } }));
        return;
      }
      requests.push(body);
      if (isRecord(body) && body["stream"] === false) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "probe",
            object: "chat.completion",
            created: 0,
            model: "probe",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "ok" },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          })
        );
        return;
      }
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "close",
      });
      res.write(chunk({ role: "assistant", content: "ok" }, null));
      res.write(chunk({}, "stop"));
      res.end("data: [DONE]\n\n");
    })();
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () =>
      new Promise<void>((resolveClose) => {
        server.closeAllConnections();
        server.close(() => resolveClose());
      }),
  };
}

export const probeProviderPath = fileURLToPath(
  new URL("probe-provider.ts", import.meta.url)
);

/**
 * The fresh Pi the probe starts: what `pnpm pi` starts, with no session file
 * (`--no-session`), the project trusted for this one process (`--approve`,
 * since a print-mode Pi can't ask), and the probe model.
 */
export const probePiArgs = [
  "--no-session",
  "--approve",
  "-e",
  probeProviderPath,
  "--model",
  "probe/probe",
  "-p",
  "hi",
];

export type ProbeOutcome =
  | { readonly ok: true; readonly seen: ProbeSeen }
  | { readonly ok: false; readonly reason: string };

export type ProbeOptions = {
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
  /** Changes Pi's flags, e.g. `--approve` to `--no-approve`. */
  readonly mapArgs?: (args: readonly string[]) => readonly string[];
};

const tail = (text: string, lines = 8) =>
  text.trim().split("\n").slice(-lines).join("\n");

/** Starts one fresh Pi against the fake endpoint and reports what it sent. */
export async function probeFreshPi(
  repoRoot: string,
  opts: ProbeOptions = {}
): Promise<ProbeOutcome> {
  const server = await startProbeServer();
  try {
    const launch = await planLaunch(
      opts.mapArgs?.(probePiArgs) ?? probePiArgs,
      repoRoot,
      opts.env
    );
    const env: NodeJS.ProcessEnv = {
      ...launch.env,
      TMX_PROBE_URL: server.url,
      PI_SKIP_VERSION_CHECK: "1",
    };
    const exit = await new Promise<{ code: number | null; output: string }>(
      (resolveExit, rejectExit) => {
        const child = spawn(process.execPath, [launch.cli, ...launch.args], {
          cwd: repoRoot,
          env,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let output = "";
        child.stdout.on("data", (d: Buffer) => (output += d.toString()));
        child.stderr.on("data", (d: Buffer) => (output += d.toString()));
        const timer = setTimeout(() => {
          output += `\n(stopped after ${opts.timeoutMs ?? 120_000} ms)`;
          child.kill("SIGTERM");
        }, opts.timeoutMs ?? 120_000);
        child.on("error", (error) => {
          clearTimeout(timer);
          rejectExit(error);
        });
        child.on("exit", (code) => {
          clearTimeout(timer);
          resolveExit({ code, output });
        });
      }
    );
    const first = server.requests[0];
    if (first === undefined) {
      return {
        ok: false,
        reason: `the fresh Pi exited ${exit.code ?? "on a signal"} before sending a request: ${tail(exit.output) || "(no output)"}`,
      };
    }
    return { ok: true, seen: seenInRequest(first) };
  } finally {
    await server.close();
  }
}
