import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

// A fake OpenAI-compatible endpoint on 127.0.0.1 that plays a fixed script
// per session, so the environment's Pis reach known states without a model.
// Each Pi gets its own base URL, `<url>/<name>/v1`, through the probe
// provider (shared/first-package/probe-provider.ts). The reply to a request
// is the script's next step: step N answers the request that carries N
// assistant messages since the last user message.

export type ScriptStep =
  | { readonly text: string }
  | { readonly tool: string; readonly args: Readonly<Record<string, unknown>> };

export type Script = readonly ScriptStep[];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Which step of a script answers this chat-completions body. */
export function stepIndex(body: unknown): number {
  const messages =
    isRecord(body) && Array.isArray(body["messages"]) ? body["messages"] : [];
  let since = 0;
  for (const message of messages) {
    const role = isRecord(message) ? message["role"] : undefined;
    if (role === "user") {
      since = 0;
    } else if (role === "assistant") {
      since += 1;
    }
  }
  return since;
}

/** The step for this body, or a plain closing line past the script's end. */
export function replyFor(script: Script, body: unknown): ScriptStep {
  return script[stepIndex(body)] ?? { text: "Nothing more to do here." };
}

const sse = (delta: object, finish: string | null) =>
  `data: ${JSON.stringify({
    id: "scripted",
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

/** The SSE stream that plays one step. */
export function streamFor(step: ScriptStep, callId: string): string {
  if ("text" in step) {
    return (
      sse({ role: "assistant", content: step.text }, null) +
      sse({}, "stop") +
      "data: [DONE]\n\n"
    );
  }
  return (
    sse(
      {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: callId,
            type: "function",
            function: { name: step.tool, arguments: JSON.stringify(step.args) },
          },
        ],
      },
      null
    ) +
    sse({}, "tool_calls") +
    "data: [DONE]\n\n"
  );
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", rejectBody);
  });
}

export type ScriptedModel = {
  /** The base URL for one session's script, ending in `/v1`. */
  readonly urlFor: (name: string) => string;
  readonly close: () => Promise<void>;
};

/** Serves `scripts[name]` at `/<name>/v1/chat/completions`. */
export async function startScriptedModel(
  scripts: Readonly<Record<string, Script>>
): Promise<ScriptedModel> {
  const server = createServer((req, res) => {
    void (async () => {
      const text = await readBody(req);
      const match = /^\/([a-z][a-z0-9-]*)\/v1\/chat\/completions$/.exec(
        String(req.url)
      );
      const script = match?.[1] === undefined ? undefined : scripts[match[1]];
      if (req.method !== "POST" || script === undefined) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "not found" } }));
        return;
      }
      let body: unknown = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "close",
      });
      // A fresh ID every call: these conversations resume run after run, and
      // a reused ID would pair a new call with an old run's result.
      res.end(
        streamFor(
          replyFor(script, body),
          `call_${randomBytes(8).toString("hex")}`
        )
      );
    })();
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const { port } = server.address() as AddressInfo;
  return {
    urlFor: (name) => `http://127.0.0.1:${port}/${name}/v1`,
    close: () =>
      new Promise<void>((resolveClose) => {
        server.closeAllConnections();
        server.close(() => resolveClose());
      }),
  };
}
