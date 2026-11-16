import { NodeRuntime, NodeServices } from "@effect/platform-node";
import {
  SetupHelpStatus,
  SetupProblemFiled,
  SetupProblemPage,
  SetupProblemReport,
  SetupProblemState,
} from "@rat-stack/core/tokenmaxx-help-contracts";
import { Config, Console, Effect, Layer, Redacted, Schema } from "effect";
import * as SecureRandom from "effect/crypto/SecureRandom";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

import {
  HelpDeskCallFailed,
  Origin,
  operatorCall,
} from "./help-desk-client.ts";

class HelpProofFailed extends Schema.TaggedError<
  HelpProofFailed,
  { readonly brand: unique symbol }
>()("HelpProofFailed", { check: Schema.String, saw: Schema.String }) {
  override get message() {
    return `Help proof failed at ${this.check}: ${this.saw}. The deployed help desk did not behave as the contract says. Fix: read the step above, then rerun \`pnpm --filter @rat-stack/site help:proof <origin> <test-email> --expect-attendees <count>\`.`;
  }
}

const Arguments = Schema.Struct({
  email: Schema.String.check(Schema.isPattern(/^\S+@\S+$/u)),
  expectAttendees: Schema.NumberFromString.pipe(
    Schema.decodeTo(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)))
  ),
  flag: Schema.Literal("--expect-attendees"),
  origin: Origin,
});

const attendeeCall = <S extends Schema.Decoder<unknown>>(
  origin: string,
  capability: "reportSetupProblem" | "setupProblemStatus",
  body: Schema.Json,
  output: S
) =>
  Effect.gen(function* callAsAttendee() {
    const response = yield* HttpClient.execute(
      HttpClientRequest.post(`${origin}/tokenmaxx/api/${capability}`).pipe(
        HttpClientRequest.bodyText(JSON.stringify(body), "application/json")
      )
    );

    const text = yield* response.text;

    if (response.status !== 200) {
      return yield* new HelpDeskCallFailed({
        capability,
        detail: text.slice(0, 300),
        status: response.status,
      });
    }

    return yield* Schema.decodeEffect(Schema.fromJsonString(output))(text);
  });

const McpReply = Schema.fromJsonString(
  Schema.Struct({
    result: Schema.Struct({
      content: Schema.optional(
        Schema.Array(Schema.Struct({ text: Schema.optional(Schema.String) }))
      ),
      isError: Schema.optional(Schema.Boolean),
      tools: Schema.optional(
        Schema.Array(Schema.Struct({ name: Schema.String }))
      ),
    }),
  })
);

const lastEvent = (text: string) =>
  text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .at(-1) ?? text;

const mcpHeaders = { accept: "application/json, text/event-stream" };

const mcpPost = (origin: string, body: Schema.Json, session?: string) =>
  HttpClient.execute(
    HttpClientRequest.post(`${origin}/tokenmaxx/mcp`).pipe(
      HttpClientRequest.setHeaders(
        session === undefined
          ? mcpHeaders
          : {
              ...mcpHeaders,
              "mcp-protocol-version": "2025-11-25",
              "mcp-session-id": session,
            }
      ),
      HttpClientRequest.bodyText(JSON.stringify(body), "application/json")
    )
  );

const mcpSession = (origin: string) =>
  Effect.gen(function* openMcpSession() {
    const opened = yield* mcpPost(origin, {
      id: 0,
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        capabilities: {},
        clientInfo: { name: "help-proof", version: "1" },
        protocolVersion: "2025-11-25",
      },
    });

    yield* opened.text;
    const session = opened.headers["mcp-session-id"] ?? "";

    yield* check(
      "mcp: initialize returns a session",
      opened.status === 200 && session.length > 0,
      `status ${String(opened.status)}`
    );

    yield* mcpPost(
      origin,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      session
    );

    return (id: number, method: string, params: Schema.Json) =>
      mcpPost(origin, { id, jsonrpc: "2.0", method, params }, session).pipe(
        Effect.flatMap((response) => response.text),
        Effect.flatMap((text) => Schema.decodeEffect(McpReply)(lastEvent(text)))
      );
  });

const check = (name: string, ok: boolean, saw: string) =>
  ok
    ? Console.log(JSON.stringify({ check: name, ok: true }))
    : Effect.fail(new HelpProofFailed({ check: name, saw }));

const program = Effect.gen(function* proveHelpDesk() {
  const { email, expectAttendees, origin } = yield* Schema.decodeUnknownEffect(
    Arguments
  )({
    email: process.argv[3],
    expectAttendees: process.argv[5],
    flag: process.argv[4],
    origin: process.argv[2],
  });

  const status = yield* operatorCall(
    origin,
    "setupHelpStatus",
    {},
    SetupHelpStatus
  );

  yield* Console.log(JSON.stringify({ status }));

  yield* check(
    "status: sign-in configured with the expected attendee count",
    status.configured &&
      status.codeSet &&
      status.attendeeCount === expectAttendees,
    `expected ${String(expectAttendees)} attendees, saw ${JSON.stringify(status)}`
  );

  yield* check(
    "status: a test list is set for this proof",
    status.testCount > 0,
    "testCount is 0; add the proof email's hash to TOKENMAXX_TEST_HASHES"
  );

  const code = Redacted.value(
    yield* Config.Redacted("TOKENMAXX_WORKSHOP_CODE")
  );

  const random = yield* SecureRandom.SecureRandom;

  const planted = [
    "sk",
    "proof",
    (yield* random.uuidV4()).replaceAll("-", ""),
  ].join("-");

  const answer = `Help proof answer ${yield* random.uuidV4()}`;

  const filed = yield* attendeeCall(
    origin,
    "reportSetupProblem",
    {
      code,
      email,
      errorText: `herdr: command not found\nOPENAI_API_KEY=${planted}`,
      step: 3,
      symptom: "Help proof: herdr: command not found after the install.",
    },
    SetupProblemFiled
  );

  yield* check(
    "file: redacted with guidance",
    filed.redacted && filed.guidance.length > 0,
    JSON.stringify(filed)
  );

  const open = yield* attendeeCall(
    origin,
    "setupProblemStatus",
    { code, email, reportId: filed.reportId },
    SetupProblemState
  );

  yield* check("status: open", open.state === "open", JSON.stringify(open));

  const mcp = yield* mcpSession(origin);
  const tools = yield* mcp(1, "tools/list", {});
  const names = (tools.result.tools ?? []).map((tool) => tool.name);

  yield* check(
    "mcp: attendee tools listed, operator tools hidden",
    names.includes("reportSetupProblem") &&
      names.includes("setupProblemStatus") &&
      !names.some((name) =>
        ["answerSetupProblem", "listSetupProblems", "setupHelpStatus"].includes(
          name
        )
      ),
    JSON.stringify(names)
  );

  const viaMcp = yield* mcp(2, "tools/call", {
    arguments: {
      code,
      email,
      errorText: `pi: no model\nANTHROPIC_API_KEY=${planted}`,
      step: 4,
      symptom: "Help proof over MCP: Pi has no model.",
    },
    name: "reportSetupProblem",
  });

  const mcpFiled = yield* Schema.decodeEffect(
    Schema.fromJsonString(SetupProblemFiled)
  )(viaMcp.result.content?.[0]?.text ?? "");

  yield* check(
    "mcp: reportSetupProblem files a redacted report",
    viaMcp.result.isError !== true && mcpFiled.redacted,
    JSON.stringify(viaMcp.result)
  );

  const listed = yield* operatorCall(
    origin,
    "listSetupProblems",
    { limit: 100, tests: "only", unansweredOnly: true },
    SetupProblemPage
  );

  const listedIds = listed.reports.map((report) => report.reportId);

  yield* check(
    "list: both test reports present, flagged, key scrubbed",
    listedIds.includes(filed.reportId) &&
      listedIds.includes(mcpFiled.reportId) &&
      listed.reports.every((report) => report.test) &&
      !JSON.stringify(listed).includes(planted) &&
      !JSON.stringify(listed).includes(email),
    JSON.stringify(listedIds)
  );

  const answered = yield* operatorCall(
    origin,
    "answerSetupProblem",
    { answer, reportId: filed.reportId },
    SetupProblemReport
  );

  yield* check(
    "answer: stored",
    answered.answer === answer,
    JSON.stringify(answered)
  );

  const read = yield* attendeeCall(
    origin,
    "setupProblemStatus",
    { code, email, reportId: filed.reportId },
    SetupProblemState
  );

  yield* check(
    "status: answered with the operator's text",
    read.state === "answered" && read.answer === answer,
    JSON.stringify(read)
  );

  yield* Console.log(
    JSON.stringify({
      ok: true,
      origin,
      reportIds: [filed.reportId, mcpFiled.reportId],
    })
  );
}).pipe(
  Effect.provide(
    Layer.mergeAll(
      NodeServices.layer,
      FetchHttpClient.layer,
      SecureRandom.layerWebCrypto
    )
  )
);

NodeRuntime.runMain(program);
