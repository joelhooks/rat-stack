import { expect, it } from "@effect/vitest";
import { IntakeTicket } from "@rat-stack/core/intake";
import {
  CONSENT_VERSION,
  InterestGate,
  InterestRequest,
  digestsMatch,
  interestOutcome,
  InterestDirectory,
  InterestMode,
  InterestTokens,
  RecordedMail,
  SubscriberConfirm,
  recordingMailerLayer,
} from "@rat-stack/core/interest";
import type {
  ConfirmState,
  SubscriberIntake,
  InterestMailer,
} from "@rat-stack/core/interest";
import { postShibaMailerLayer } from "@rat-stack/subscriber-delivery";
import { Clock, Effect, Layer, Redacted, Ref, Schema } from "effect";
import type { Context } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import * as HttpRouter from "effect/unstable/http/HttpRouter";

import { copyPrompts } from "../scripts/component-data.ts";
import { htmlTokens } from "../scripts/svx-ast.ts";
import { agentNextActions } from "../src/agent-guide.js";
import { mischiefRoutes, toolkitProjection } from "../src/app.js";
import {
  capabilities,
  contentCapabilities,
  executeProjection,
} from "../src/capabilities/index.js";
import {
  llmsText,
  publicPaths,
  searchContent,
  sitemapXml,
} from "../src/content.js";
import {
  interestCapabilities,
  registerInterest,
} from "../src/interest/handlers.js";
import { fakeIntake, fakeIntakeLayer } from "./fixtures/fake-intake.js";
import { TestSandbox } from "./test-sandbox.js";

type WebHandler = (request: Request) => Promise<Response>;

const withInterest = <A, E, R>(
  use: (handler: WebHandler) => Effect.Effect<A, E, R>,
  confirmation: Layer.Layer<SubscriberConfirm> = SubscriberConfirm.unconfigured
) =>
  Effect.gen(function* routeFixture() {
    const intake = yield* fakeIntake([{ kind: "accepted" }]);

    const services = yield* Layer.build(
      Layer.mergeAll(
        InterestDirectory.memory,
        InterestMode.layer("drovr"),
        InterestTokens.layer(Redacted.make("test-token-secret")),
        intake.layer,
        confirmation,
        recordingMailerLayer
      )
    );

    const { handler, dispose } = HttpRouter.toWebHandler(
      mischiefRoutes({ interest: { services } }).pipe(
        Layer.provide(TestSandbox),
        Layer.provide(IntakeTicket.testLayer)
      )
    );

    yield* Effect.addFinalizer(() => Effect.promise(dispose));
    const result = yield* use(handler);
    expect(yield* intake.calls).toEqual([]);

    const directory = yield* InterestDirectory.pipe(
      Effect.provideContext(services)
    );

    expect(yield* directory.summary).toEqual({
      captured: 0,
      confirmed: [],
      pending: 0,
    });
    const mail = yield* RecordedMail.pipe(Effect.provideContext(services));
    expect(yield* mail.all).toEqual([]);

    return result;
  }).pipe(Effect.scoped);

const call = (handler: WebHandler, request: Request) =>
  Effect.promise(handler.bind(undefined, request));

const responseBody = (response: Response) =>
  Effect.promise(response.text.bind(response));

const getView = (handler: WebHandler, path: string, accept = "text/html") =>
  call(
    handler,
    new Request(`https://ratstack.sh${path}`, { headers: { accept } })
  );

it.effect(
  "retired submission endpoints answer 410 without parsing, capturing, mailing or delivery",
  () =>
    withInterest((handler) =>
      Effect.gen(function* retiredSubmissions() {
        for (const path of ["/tokenmaxx/interest", "/api/registerInterest"]) {
          for (const payload of [
            "email=person%40example.com",
            '{"email":"person@example.com"}',
            "not valid JSON",
          ]) {
            const response = yield* call(
              handler,
              new Request(`https://ratstack.sh${path}`, {
                body: payload,
                headers: { "content-type": "application/json" },
                method: "POST",
              })
            );

            expect(response.status).toBe(410);
            expect(response.headers.get("content-type")).toContain(
              "application/problem+json"
            );
            const problem = yield* responseBody(response);
            expect(problem).toContain("joinInterest");
            expect(problem).toContain(
              "https://ratstack.sh/tokenmaxx#interested"
            );
          }
        }
      })
    )
);

it.effect(
  "offers the agent-only primary application control and no retired form or Shield",
  () =>
    withInterest((handler) =>
      Effect.gen(function* applicationViews() {
        for (const accept of ["text/html", "text/markdown"]) {
          const response = yield* getView(handler, "/tokenmaxx", accept);
          const text = yield* responseBody(response);
          expect(response.status).toBe(200);
          expect(response.headers.get("x-robots-tag")).toBe("noindex");
          expect(response.headers.get("cache-control")).toBe("no-store");
          const policy = response.headers.get("content-security-policy") ?? "";
          expect(policy).not.toContain("postshiba");
          expect(policy).not.toContain("worker-src");
          expect(policy).toContain("form-action 'none'");

          for (const retired of [
            "<form",
            "shield-shiba",
            "__SHIELD_SHIBA_WIDGET__",
            "Join the interest list",
            "Verify you're human",
            "browser signup",
            "browser form",
          ]) {
            expect(text).not.toContain(retired);
          }

          expect(text).toContain('id="interested"');
          expect(text).toContain("Free workshop");
          expect(text).toContain("Free, by application. Very limited seats.");
          expect(text).toContain("Date to be set with attendees.");
          expect(text).toContain("Apply through your agent");

          if (accept === "text/html") {
            const buttons = htmlTokens(text).filter(
              (token) => token.kind === "open" && token.name === "button"
            );

            const primary = buttons.filter(
              (token) =>
                token.attributes.class?.includes("copy-primary") ?? false
            );

            const names = htmlTokens(text).flatMap((token) =>
              token.kind === "open"
                ? [token.attributes.id ?? "", token.attributes.class ?? ""]
                : []
            );

            expect(names.join(" ")).not.toMatch(
              /(?:^|\s)(?:ad-banner|advertisement|sponsored|promo-banner|signup-form)(?:\s|$)/u
            );
            expect(primary).toHaveLength(1);
            expect(primary[0]?.attributes["data-text"]).toBe(
              copyPrompts.page.text
            );
            expect(primary[0]?.attributes["aria-label"]).toBe(
              "Apply through your agent"
            );
            expect(text).toContain('role="status" aria-live="polite"');
            expect(text).toContain('label.textContent = "Copied ✓"');
            expect(text).toContain("Copy for agent");
            expect(text).not.toContain("What are you building?");
          } else {
            expect(text).toContain(
              "[Apply through your agent](#apply-through-your-agent)"
            );
            expect(text).toContain("Question 5 defaults to no.");
            expect(text).toContain(
              "Never inspect their machine to answer them."
            );
            expect(text).toContain("Confirmation is not a seat.");
            expect(text).toContain(
              '"consent": { "contact": true, "share": false }'
            );
          }

          expect(text).not.toContain("__INTAKE_PAGE_TICKET__");
        }
      })
    )
);

it.effect(
  "keeps the retired capability out of published inventories and guidance",
  () =>
    withInterest((handler) =>
      Effect.gen(function* retiredInventory() {
        expect(Object.keys(toolkitProjection.toolkit.tools)).not.toContain(
          "registerInterest"
        );
        expect(
          capabilities.map((capability) => capability.contract.name)
        ).not.toContain("registerInterest");
        expect(JSON.stringify(executeProjection.catalog)).not.toContain(
          "registerInterest"
        );
        expect(executeProjection.declarations).not.toContain(
          "registerInterest"
        );
        expect(llmsText("https://ratstack.sh")).not.toContain(
          "registerInterest"
        );
        expect(agentNextActions("https://ratstack.sh")).not.toContain(
          "registerInterest"
        );
        expect(llmsText("https://ratstack.sh")).not.toContain(
          "browser submission"
        );

        const openapi = yield* responseBody(
          yield* getView(handler, "/openapi.json", "application/json")
        );

        expect(openapi).not.toContain("registerInterest");
        expect(openapi).toContain("joinInterest");

        const list = yield* call(
          handler,
          new Request("https://ratstack.sh/mcp", {
            body: JSON.stringify({
              id: 1,
              jsonrpc: "2.0",
              method: "tools/list",
              params: {
                _meta: {
                  "io.modelcontextprotocol/clientCapabilities": {},
                  "io.modelcontextprotocol/clientInfo": {
                    name: "InterestTest",
                    version: "1",
                  },
                  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                },
              },
            }),
            headers: {
              "MCP-Protocol-Version": "2026-07-28",
              "Mcp-Method": "tools/list",
              accept: "application/json, text/event-stream",
              "content-type": "application/json",
            },
            method: "POST",
          })
        );

        expect(list.status).toBe(200);
        const tools = yield* responseBody(list);
        expect(tools).toContain("joinInterest");
        expect(tools).not.toContain("registerInterest");
      })
    )
);

it.effect("keeps confirmation routes and email-link redirects available", () =>
  withInterest((handler) =>
    Effect.gen(function* retainedConfirmation() {
      for (const method of ["GET", "POST"]) {
        const redirect = yield* call(
          handler,
          new Request("https://ratstack.sh/confirm?token=test", { method })
        );

        expect(redirect.status).toBe(308);
        expect(redirect.headers.get("location")).toBe(
          "/tokenmaxx/confirm?token=test"
        );

        const response = yield* call(
          handler,
          new Request("https://ratstack.sh/tokenmaxx/confirm?token=test", {
            body: method === "POST" ? "token=test" : null,
            headers: { "content-type": "application/x-www-form-urlencoded" },
            method,
          })
        );

        expect(response.status).toBe(410);
        expect(
          (yield* responseBody(response)).replaceAll("&#39;", "'")
        ).toContain("This link isn't valid");
      }
    })
  )
);

it.effect(
  "email-link confirmation reads pending state and confirms only on POST",
  () =>
    Effect.gen(function* browserConfirmation() {
      const confirms = yield* Ref.make(0);

      const confirmation = Layer.succeed(SubscriberConfirm, {
        confirm: () =>
          Ref.update(confirms, (count) => count + 1).pipe(
            Effect.as("confirmed" as const)
          ),
        state: () => Effect.succeed("pending" as const),
      });

      yield* withInterest(
        (handler) =>
          Effect.gen(function* confirmRequests() {
            const pending = yield* getView(
              handler,
              "/tokenmaxx/confirm?token=test"
            );

            expect(pending.status).toBe(200);
            expect(yield* responseBody(pending)).toContain(
              "Confirm your email"
            );
            expect(yield* Ref.get(confirms)).toBe(0);

            const confirmed = yield* call(
              handler,
              new Request("https://ratstack.sh/tokenmaxx/confirm", {
                body: "token=test",
                headers: {
                  "content-type": "application/x-www-form-urlencoded",
                },
                method: "POST",
              })
            );

            expect(confirmed.status).toBe(200);
            expect(
              (yield* responseBody(confirmed)).replaceAll("&#39;", "'")
            ).toContain("You're confirmed");
            expect(yield* Ref.get(confirms)).toBe(1);
          }),
        confirmation
      );
    })
);

it.effect(
  "keeps the workshop out of the sitemap and its screenshot available",
  () =>
    withInterest((handler) =>
      Effect.gen(function* workshopDiscovery() {
        expect(publicPaths).not.toContain("/tokenmaxx");
        expect(sitemapXml("https://ratstack.sh")).not.toContain("/tokenmaxx");

        const screenshot = yield* getView(
          handler,
          "/tokenmaxx/four-comma-club.jpg"
        );

        expect(screenshot.status).toBe(200);
        expect(screenshot.headers.get("content-type")).toBe("image/jpeg");
      })
    )
);

type LiveInterestServices = Context.Context<
  | RecordedMail
  | InterestDirectory
  | InterestTokens
  | InterestMode
  | InterestMailer
  | SubscriberIntake
  | SubscriberConfirm
  | InterestGate
  | InterestRequest
>;

const tokenSecret = Redacted.make("route-test-secret");

const operatorToken = "operator-test-token";

const postedMailRequests: Request[] = [];

const fakeHttp = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) => {
    postedMailRequests.push(new Request("http://provider.test/"));

    return Effect.succeed(
      HttpClientResponse.fromWeb(request, Response.json({ queued: true }))
    );
  })
);

const requestFixture = Layer.mergeAll(
  Layer.succeed(InterestGate, { allow: () => Effect.succeed(true) }),
  Layer.succeed(InterestRequest, {
    ip: "203.0.113.7",
    origin: "https://ratstack.sh",
    userAgent: "test-agent",
  })
);

const withLiveInterest = <A, E, R>(
  use: (
    handler: WebHandler,
    services: LiveInterestServices
  ) => Effect.Effect<A, E, R>,
  options: {
    readonly confirm?: Layer.Layer<SubscriberConfirm>;
    readonly intake?: Layer.Layer<SubscriberIntake>;
    readonly mode?: "capture" | "doi" | "drovr";
    readonly operator?: boolean;
  } = {}
) =>
  Effect.scoped(
    Effect.gen(function* liveInterestFixture() {
      const services = yield* Layer.build(
        Layer.mergeAll(
          InterestDirectory.memory,
          InterestTokens.layer(tokenSecret),
          InterestMode.layer(options.mode ?? "doi"),
          options.intake ?? fakeIntakeLayer,
          options.confirm ?? SubscriberConfirm.unconfigured,
          recordingMailerLayer,
          requestFixture,
          Layer.succeed(Clock.Clock, yield* Clock.Clock)
        )
      );

      const { handler, dispose } = HttpRouter.toWebHandler(
        mischiefRoutes({
          interest: {
            operatorToken:
              options.operator === false ? undefined : operatorToken,
            services,
          },
        }).pipe(
          Layer.provide(TestSandbox),
          Layer.provide(IntakeTicket.testLayer)
        ),
        { disableLogger: true }
      );

      yield* Effect.addFinalizer(() => Effect.promise(dispose));

      return yield* use(handler, services);
    })
  );

const seedPending = (
  services: LiveInterestServices,
  address = "reader@example.com"
) =>
  Effect.gen(function* pendingFixture() {
    const directory = yield* InterestDirectory;
    const outcome = yield* directory.register(address);

    if (!interestOutcome.$is("SendConfirmation")(outcome)) {
      return yield* Effect.die("Expected pending fixture");
    }

    const tokens = yield* InterestTokens;

    const token = yield* tokens.sign({
      address,
      expiresAt: outcome.record.expiresAt ?? 0,
    });

    return `https://ratstack.sh/tokenmaxx/confirm?token=${encodeURIComponent(token)}`;
  }).pipe(Effect.provideContext(services));

const seedCapture = (services: LiveInterestServices, address: string) =>
  InterestDirectory.use((directory) =>
    directory.register(address, {
      consentVersion: CONSENT_VERSION,
      ipHash: "hashed-ip",
      submissionId: `fixture-${address}`,
      uaHash: "hashed-agent",
    })
  ).pipe(Effect.provideContext(services));

const seedLocalMail = (services: LiveInterestServices) =>
  registerInterest
    .handler({ email: "reader@example.com" })
    .pipe(Effect.provideContext(services));

const drovrMode = (script: ReturnType<typeof fakeIntake>) =>
  Effect.gen(function* withScript() {
    const intake = yield* script;

    return {
      ...intake,
      options: { intake: intake.layer, mode: "drovr" } as const,
    };
  });

const tryAgain = "We couldn't verify that. Please try again.";

const form = (
  path: string,
  fields: Readonly<Record<string, string>>,
  ip = "203.0.113.7"
) =>
  new Request(`https://ratstack.sh${path}`, {
    body: new URLSearchParams(fields).toString(),
    headers: {
      "cf-connecting-ip": ip,
      "content-type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

const text = (response: Response) =>
  Effect.promise(response.text.bind(response));

const sent = (services: Context.Context<RecordedMail>) =>
  RecordedMail.use((recorded) => recorded.all).pipe(
    Effect.provideContext(services)
  );

const json = (response: Response) =>
  Effect.promise(response.json.bind(response));

const visible = (html: string) =>
  html.replaceAll("&#39;", "'").replaceAll("&quot;", '"');

const linkIn = (body: string) =>
  /https:\/\/ratstack\.sh\/tokenmaxx\/confirm\?token=[^\s]+/u.exec(body)?.[0] ??
  "";

const capturing = { mode: "capture" } as const;

const operatorGet = (path: string, bearer = operatorToken) =>
  new Request(`https://ratstack.sh${path}`, {
    headers: { authorization: `Bearer ${bearer}` },
  });

const operatorPost = (path: string, body: Schema.Json) =>
  new Request(`https://ratstack.sh${path}`, {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${operatorToken}`,
      "content-type": "application/json",
    },
    method: "POST",
  });

const Captures = Schema.Array(
  Schema.Struct({
    address: Schema.String,
    capturedAt: Schema.Finite,
    consentVersion: Schema.String,
    ipHash: Schema.String,
    submissionId: Schema.String,
    uaHash: Schema.String,
  })
);

const captures = (handler: WebHandler) =>
  call(handler, operatorGet("/operator/interest/captures")).pipe(
    Effect.flatMap(json),
    Effect.flatMap(Schema.decodeUnknownEffect(Captures))
  );

const confirmFake = (
  state: ConfirmState,
  outcome: Exclude<ConfirmState, "pending">
) =>
  Layer.succeed(SubscriberConfirm, {
    confirm: () => Effect.succeed(outcome),
    state: () => Effect.succeed(state),
  });

const pageStates = [
  {
    heading: "<h1>You're confirmed</h1>",
    link: '<a href="/">Return to ratstack.sh</a>',
    state: "confirmed",
    status: 200,
  },
  {
    heading: "This link has expired</h1>",
    link: '<a href="/tokenmaxx#interested">Return to signup</a>',
    state: "expired",
    status: 410,
  },
  {
    heading: "This link isn't valid</h1>",
    link: '<a href="/tokenmaxx#interested">Return to signup</a>',
    state: "invalid",
    status: 410,
  },
] as const;

const tokenmaxxPage = (handler: WebHandler, accept: string) =>
  call(
    handler,
    new Request("https://ratstack.sh/tokenmaxx", { headers: { accept } })
  );

const setupPromptLines = [
  'Check my setup for the "how to burn a trillion tokens and get good results" session.',
  "1. Check that Docker is running (Docker Desktop or OrbStack).",
  "2. Create a private repo from the joelhooks/rat-stack template and clone it: gh repo create my-factory --private --template joelhooks/rat-stack",
  "3. Read https://ratstack.sh/llms.txt",
  "4. Tell me what is missing.",
];

const sha256Base64 = (value: string) =>
  Effect.promise(
    // oxlint-disable-next-line typescript/promise-function-async -- Web Crypto owns this Promise-returning boundary.
    () => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  ).pipe(
    Effect.map((digest) =>
      btoa(String.fromCodePoint(...new Uint8Array(digest)))
    )
  );

it.effect(
  "serves the workshop page unlisted, noindex, with an agent application button",
  () =>
    withLiveInterest((handler) =>
      Effect.gen(function* servesPage() {
        const response = yield* call(
          handler,
          new Request("https://ratstack.sh/tokenmaxx", {
            headers: { accept: "text/html" },
          })
        );

        const html = yield* text(response);

        expect(response.status).toBe(200);
        expect(response.headers.get("x-robots-tag")).toBe("noindex");
        expect(response.headers.get("content-security-policy")).toContain(
          "form-action 'none'"
        );
        expect(html).toContain('<meta name="robots" content="noindex"');
        expect(html).not.toContain("<form");
        expect(html).toContain('<h2 id="interested">Free workshop</h2>');
        expect(html).toContain("Apply through your agent");
      })
    )
);

it.effect(
  "keeps the workshop page out of the sitemap, search, and lore index with an agent-guide pointer",
  () =>
    Effect.sync(() => {
      expect(publicPaths).not.toContain("/tokenmaxx");
      expect(sitemapXml("https://ratstack.sh")).not.toContain("tokenmaxx");
      expect(llmsText("https://ratstack.sh")).toContain(
        "https://ratstack.sh/tokenmaxx#interested"
      );
      expect(
        searchContent("burn a trillion tokens workshop").map(
          ({ routePath }) => routePath
        )
      ).not.toContain("/tokenmaxx");
    })
);

it.effect(
  "serves the workshop page as Markdown to agents, without the form",
  () =>
    withLiveInterest((handler) =>
      Effect.gen(function* servesMarkdown() {
        const response = yield* call(
          handler,
          new Request("https://ratstack.sh/tokenmaxx", {
            headers: { accept: "text/markdown" },
          })
        );

        const markdown = yield* text(response);

        expect(response.headers.get("content-type")).toContain("text/markdown");
        expect(markdown).toContain(
          "# how to burn a trillion tokens and get good results"
        );
        expect(markdown).not.toContain("<form");
      })
    )
);

it.effect("keeps the only rat in the nav brand on the workshop page", () =>
  withLiveInterest((handler) =>
    Effect.gen(function* servesOneRat() {
      const response = yield* call(
        handler,
        new Request("https://ratstack.sh/tokenmaxx", {
          headers: { accept: "text/html" },
        })
      );

      const html = yield* text(response);
      const body = html.slice(html.indexOf("<body"));

      expect(body.match(/🐀/gu)).toHaveLength(1);
      expect(body).toContain("<strong>🐀 Rat Stack</strong>");
    })
  )
);

it.effect("serves the credited screenshot", () =>
  withLiveInterest((handler) =>
    Effect.gen(function* servesImage() {
      const response = yield* call(
        handler,
        new Request("https://ratstack.sh/tokenmaxx/four-comma-club.jpg")
      );

      const bytes = new Uint8Array(
        yield* Effect.promise(response.arrayBuffer.bind(response))
      );

      expect(response.headers.get("content-type")).toBe("image/jpeg");
      expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    })
  )
);

it.effect(
  "sends the approved email with the confirm link as the only substitution",
  () =>
    withLiveInterest((_handler, services) =>
      Effect.gen(function* approvedEmail() {
        yield* seedLocalMail(services);
        const [mail] = yield* sent(services);
        const link = linkIn(mail?.text ?? "");

        expect(mail?.from).toBe("workshop@ratstack.sh");
        expect(mail?.subject).toBe("Confirm: how to burn a trillion tokens");
        expect(mail?.to).toBe("reader@example.com");
        expect(link).not.toBe("");
        expect(mail?.text).toBe(
          `Hi,

You asked to hear about "how to burn a trillion tokens," a four-hour workshop on agent harnesses at ratstack.sh.

Confirm your email:
${link}

The link expires in 72 hours. After you confirm, you'll get one email when the date is set, and that's it.

If you didn't ask for this, ignore it. You won't get anything else.

Joel Hooks`
        );
      })
    )
);

it.effect(
  "counts an address only after its link is used, and shows the operator the list",
  () =>
    withLiveInterest((handler, services) =>
      Effect.gen(function* confirmFlow() {
        const link = yield* seedPending(services);
        const token = decodeURIComponent(link.split("token=")[1] ?? "");

        const operator = (bearer: string) =>
          call(
            handler,
            new Request("https://ratstack.sh/operator/interest", {
              headers: { authorization: `Bearer ${bearer}` },
            })
          );

        const beforeBody = yield* json(yield* operator(operatorToken));

        const prompt = yield* call(handler, new Request(link));
        const promptHtml = yield* text(prompt);

        const afterPrompt = yield* json(yield* operator(operatorToken));

        const confirmed = yield* call(
          handler,
          form("/tokenmaxx/confirm", { token })
        );

        const confirmedHtml = yield* text(confirmed);

        const afterBody = yield* json(yield* operator(operatorToken));

        expect(beforeBody).toEqual({ captured: 0, confirmed: [], pending: 1 });
        expect(afterPrompt).toEqual({ captured: 0, confirmed: [], pending: 1 });
        expect(promptHtml).toContain('action="/tokenmaxx/confirm"');
        expect(promptHtml).toContain(`value="${token}"`);
        expect(confirmed.status).toBe(200);
        expect(visible(confirmedHtml)).toContain("<h1>You're confirmed</h1>");
        expect(afterBody).toMatchObject({
          confirmed: [{ address: "reader@example.com" }],
          pending: 0,
        });
        expect((yield* operator("wrong")).status).toBe(401);
      })
    )
);

it.effect("refuses a link whose token was changed", () =>
  withLiveInterest((handler, services) =>
    Effect.gen(function* tampered() {
      const link = yield* seedPending(services);
      const token = decodeURIComponent(link.split("token=")[1] ?? "");

      const [, signature] = token.split(".");

      const forged = btoa(
        JSON.stringify({ address: "someone@example.com", expiresAt: 9e15 })
      )
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");

      const refused = yield* call(
        handler,
        form("/tokenmaxx/confirm", { token: `${forged}.${signature}` })
      );

      expect(refused.status).toBe(410);
      expect(visible(yield* text(refused))).toContain(
        "This link isn't valid</h1>"
      );
    })
  )
);

it.effect(
  "keeps the operator read off without a token and behind it with one",
  () =>
    Effect.gen(function* operatorRead() {
      const off = yield* withLiveInterest(
        (handler) =>
          call(handler, new Request("https://ratstack.sh/operator/interest")),
        { operator: false }
      );

      const closed = yield* withLiveInterest((handler) =>
        call(handler, new Request("https://ratstack.sh/operator/interest"))
      );

      expect([off.status, closed.status]).toEqual([404, 401]);
    })
);

it.effect(
  "keeps the interest capabilities off the public MCP toolkit, RPC, and code mode",
  () =>
    Effect.sync(() => {
      const interestNames = ["registerInterest", "confirmInterest"];
      const mcpTools = Object.keys(toolkitProjection.toolkit.tools);

      const executable = contentCapabilities.map(
        ({ contract }) => contract.name
      );

      const listed = capabilities.map(({ contract }) => contract.name);

      for (const name of interestNames) {
        expect(mcpTools).not.toContain(name);
        expect(executable).not.toContain(name);
        expect(listed).not.toContain(name);
      }

      expect(interestCapabilities.map(({ contract }) => contract.name)).toEqual(
        ["confirmInterest"]
      );
    })
);

it.effect(
  "does not call the provider while sending is disabled, and answers the same",
  () =>
    Effect.scoped(
      Effect.gen(function* disabledSending() {
        postedMailRequests.length = 0;

        const services = yield* Layer.build(
          Layer.mergeAll(
            InterestDirectory.memory,
            InterestTokens.layer(tokenSecret),
            InterestMode.layer("doi"),
            fakeIntakeLayer,
            SubscriberConfirm.unconfigured,
            postShibaMailerLayer({
              apiKey: Redacted.make("not-a-real-key"),
              cluster: "cluster",
              enabled: false,
              team: "team",
            }).pipe(Layer.provide(fakeHttp))
          )
        );

        const answered = yield* registerInterest
          .handler({ email: "quiet@example.com" })
          .pipe(
            Effect.provideContext(services),
            Effect.provide(requestFixture)
          );

        expect(answered.message).toBe(
          "Check your email for a link to confirm."
        );
        expect(postedMailRequests).toHaveLength(0);
        yield* registerInterest
          .handler({ email: "quiet@example.com" })
          .pipe(
            Effect.provideContext(services),
            Effect.provide(requestFixture)
          );
        expect(postedMailRequests).toHaveLength(0);
      })
    )
);

it.effect("compares operator tokens by digest", () =>
  Effect.gen(function* digests() {
    expect(yield* digestsMatch("a", "a")).toBe(true);
    expect(yield* digestsMatch("a", "b")).toBe(false);
  })
);

it.effect("renders the four confirm pages with the approved copy", () =>
  withLiveInterest((handler, services) =>
    Effect.gen(function* confirmPages() {
      const link = yield* seedPending(services);
      const token = decodeURIComponent(link.split("token=")[1] ?? "");

      const pending = visible(
        yield* text(yield* call(handler, new Request(link)))
      );

      expect(pending).toContain("<h1>Confirm your email</h1>");
      expect(pending).toContain(
        '<p>You asked to hear about "how to burn a trillion tokens," a four-hour workshop on agent harnesses at ratstack.sh. Confirm your email to get one email when the date is set, and that\'s it.</p>'
      );
      expect(pending).toContain(
        '<button type="submit">Confirm my email</button>'
      );
      expect(pending).not.toContain("Back to the workshop page");

      const confirmed = visible(
        yield* text(yield* call(handler, form("/tokenmaxx/confirm", { token })))
      );

      expect(confirmed).toContain("<h1>You're confirmed</h1>");
      expect(confirmed).toContain(
        "<p>You'll get one email when the date is set, and that's it.</p>"
      );
      expect(confirmed).toContain('<a href="/">Return to ratstack.sh</a>');

      const expiredToken = yield* InterestTokens.use((tokens) =>
        tokens.sign({ address: "reader@example.com", expiresAt: -1 })
      ).pipe(Effect.provide(InterestTokens.layer(tokenSecret)));

      const expiredGet = yield* call(
        handler,
        new Request(
          `https://ratstack.sh/tokenmaxx/confirm?token=${encodeURIComponent(expiredToken)}`
        )
      );

      const expiredPost = yield* call(
        handler,
        form("/tokenmaxx/confirm", { token: expiredToken })
      );

      for (const response of [expiredGet, expiredPost]) {
        const html = visible(yield* text(response));

        expect(response.status).toBe(410);
        expect(html).toContain("This link has expired</h1>");
        expect(html).toContain(
          "<p>Confirmation links expire in 72 hours. Return to the workshop page to apply through your agent and request a new link.</p>"
        );
        expect(html).toContain(
          '<a href="/tokenmaxx#interested">Return to signup</a>'
        );
      }

      for (const response of [
        yield* call(
          handler,
          new Request("https://ratstack.sh/tokenmaxx/confirm?token=garbage")
        ),
        yield* call(handler, form("/tokenmaxx/confirm", { token: "garbage" })),
      ]) {
        const html = visible(yield* text(response));

        expect(response.status).toBe(410);
        expect(html).toContain("This link isn't valid</h1>");
        expect(html).toContain(
          "<p>Return to the workshop page to apply through your agent and request a confirmation link.</p>"
        );
        expect(html).toContain(
          '<a href="/tokenmaxx#interested">Return to signup</a>'
        );
      }
    })
  )
);

it.effect(
  "shows the invalid-link page for every confirm request in capture mode",
  () =>
    withLiveInterest(
      (handler) =>
        Effect.gen(function* captureConfirm() {
          const token = yield* InterestTokens.use((tokens) =>
            tokens.sign({
              address: "valid@example.com",
              expiresAt: 60_000,
            })
          ).pipe(Effect.provide(InterestTokens.layer(tokenSecret)));

          const responses = [
            yield* call(
              handler,
              new Request(
                `https://ratstack.sh/tokenmaxx/confirm?token=${encodeURIComponent(token)}`
              )
            ),
            yield* call(handler, form("/tokenmaxx/confirm", { token })),
          ];

          for (const response of responses) {
            const html = visible(yield* text(response));

            expect(response.status).toBe(410);
            expect(html).toContain("This link isn't valid</h1>");
            expect(html).toContain(
              "<p>Return to the workshop page to apply through your agent and request a confirmation link.</p>"
            );
            expect(html).toContain(
              '<a href="/tokenmaxx#interested">Return to signup</a>'
            );
          }
        }),
      capturing
    )
);

it.effect("keeps the capture export and delete behind the operator token", () =>
  withLiveInterest(
    (handler) =>
      Effect.gen(function* guardedCaptureRoutes() {
        const statuses = [
          (yield* call(
            handler,
            operatorGet("/operator/interest/captures", "wrong")
          )).status,
          (yield* call(
            handler,
            new Request("https://ratstack.sh/operator/interest/captures")
          )).status,
          (yield* call(
            handler,
            new Request("https://ratstack.sh/operator/interest/delete", {
              body: JSON.stringify({ addresses: ["a@example.com"] }),
              headers: { "content-type": "application/json" },
              method: "POST",
            })
          )).status,
          (yield* call(
            handler,
            operatorPost("/operator/interest/delete", { nothing: true })
          )).status,
        ];

        expect(statuses).toEqual([401, 401, 401, 400]);
      }),
    capturing
  )
);

it.effect(
  "deletes captures by submission id or by address and answers with counts only",
  () =>
    withLiveInterest(
      (handler, services) =>
        Effect.gen(function* deleteCaptures() {
          yield* seedCapture(services, "one@example.com");
          yield* seedCapture(services, "two@example.com");
          yield* seedCapture(services, "three@example.com");

          const all = yield* captures(handler);
          const one = all.find(({ address }) => address === "one@example.com");

          const byId = yield* call(
            handler,
            operatorPost("/operator/interest/delete", {
              submissionIds: [one?.submissionId ?? "", "no-such-id"],
            })
          );

          const byIdBody = yield* text(byId);

          const byAddress = yield* call(
            handler,
            operatorPost("/operator/interest/delete", {
              addresses: [
                "TWO@example.com",
                "missing@example.com",
                "not an address",
              ],
            })
          );

          const byAddressBody = yield* text(byAddress);

          expect(JSON.parse(byIdBody)).toEqual({
            deleted: 1,
            notFound: 1,
            requested: 2,
          });
          expect(JSON.parse(byAddressBody)).toEqual({
            deleted: 1,
            notFound: 2,
            requested: 3,
          });
          expect(`${byIdBody}${byAddressBody}`).not.toContain("@");
          expect(
            (yield* captures(handler)).map(({ address }) => address)
          ).toEqual(["three@example.com"]);

          const summary = yield* json(
            yield* call(handler, operatorGet("/operator/interest"))
          );

          expect(summary).toEqual({ captured: 1, confirmed: [], pending: 0 });

          yield* seedCapture(services, "one@example.com");

          expect(
            (yield* captures(handler)).map(({ address }) => address)
          ).toContain("one@example.com");
        }),
      capturing
    )
);

it.effect("refuses on any other drovr answer without showing a reason", () =>
  Effect.gen(function* refusedByDrovr() {
    const { calls, options } = yield* drovrMode(
      fakeIntake([{ kind: "refused" }])
    );

    yield* withLiveInterest(
      (_handler, services) =>
        Effect.gen(function* refusal() {
          const failure = yield* registerInterest
            .handler({ email: "no@example.com", shieldToken: "challenge" })
            .pipe(Effect.flip, Effect.provideContext(services));

          expect(failure.message).toBe(tryAgain);
          expect(failure.message).not.toContain("Check your email for a link");
          expect(yield* calls).toHaveLength(1);
        }),
      options
    );
  })
);

it.effect("sends the email's /confirm link to the confirm page", () =>
  Effect.gen(function* confirmAlias() {
    yield* withLiveInterest(
      (handler) =>
        Effect.gen(function* redirects() {
          for (const request of [
            new Request("https://ratstack.sh/confirm?token=a%2Bb"),
            form("/confirm", { token: "t" }),
          ]) {
            const response = yield* call(handler, request);

            expect(response.status).toBe(308);
          }

          const get = yield* call(
            handler,
            new Request("https://ratstack.sh/confirm?token=a%2Bb")
          );

          expect(get.headers.get("location")).toBe(
            "/tokenmaxx/confirm?token=a%2Bb"
          );
        }),
      { confirm: confirmFake("pending", "confirmed"), mode: "drovr" }
    );
  })
);

it.effect("renders each confirm page from drovr's token state", () =>
  Effect.gen(function* confirmStates() {
    yield* withLiveInterest(
      (handler) =>
        Effect.gen(function* pending() {
          const html = visible(
            yield* text(
              yield* call(
                handler,
                new Request("https://ratstack.sh/tokenmaxx/confirm?token=t")
              )
            )
          );

          expect(html).toContain("<h1>Confirm your email</h1>");
          expect(html).toContain(
            '<button type="submit">Confirm my email</button>'
          );
          expect(html).toContain('value="t"');
        }),
      { confirm: confirmFake("pending", "confirmed"), mode: "drovr" }
    );

    for (const { heading, link, state, status } of pageStates) {
      yield* withLiveInterest(
        (handler) =>
          Effect.gen(function* renders() {
            const get = yield* call(
              handler,
              new Request("https://ratstack.sh/tokenmaxx/confirm?token=t")
            );

            const post = yield* call(
              handler,
              form("/tokenmaxx/confirm", { token: "t" })
            );

            for (const response of [get, post]) {
              const html = visible(yield* text(response));

              expect(response.status).toBe(status);
              expect(html).toContain(heading);
              expect(html).toContain(link);
            }
          }),
        {
          confirm: confirmFake(state, state),
          mode: "drovr",
        }
      );
    }
  })
);

it.effect(
  "shows the invalid page when drovr's confirm port is not configured",
  () =>
    withLiveInterest(
      (handler) =>
        Effect.gen(function* unconfigured() {
          const response = yield* call(
            handler,
            new Request("https://ratstack.sh/tokenmaxx/confirm?token=t")
          );

          expect(response.status).toBe(410);
          expect(visible(yield* text(response))).toContain(
            "This link isn't valid</h1>"
          );
        }),
      { mode: "drovr" }
    )
);

it.effect("GET reads the token state and never confirms; POST confirms", () =>
  Effect.gen(function* getNeverConfirms() {
    const reads: string[] = [];
    const confirms: string[] = [];

    const spy = Layer.succeed(SubscriberConfirm, {
      confirm: (token: string) =>
        Effect.sync(() => {
          confirms.push(token);

          return "confirmed" as const;
        }),
      state: (token: string) =>
        Effect.sync(() => {
          reads.push(token);

          return "pending" as const;
        }),
    });

    yield* withLiveInterest(
      (handler) =>
        Effect.gen(function* getThenPost() {
          yield* call(
            handler,
            new Request("https://ratstack.sh/tokenmaxx/confirm?token=abc")
          );

          expect(reads).toEqual(["abc"]);
          expect(confirms).toEqual([]);

          yield* call(handler, form("/tokenmaxx/confirm", { token: "abc" }));

          expect(confirms).toEqual(["abc"]);
        }),
      { confirm: spy, mode: "drovr" }
    );
  })
);

it.effect(
  "shows the setup prompt in both views, with the button and script only in HTML",
  () =>
    withLiveInterest((handler) =>
      Effect.gen(function* views() {
        const htmlResponse = yield* tokenmaxxPage(handler, "text/html");
        const html = yield* text(htmlResponse);

        const markdown = yield* text(
          yield* tokenmaxxPage(handler, "text/markdown")
        );

        for (const line of setupPromptLines) {
          expect(html).toContain(line.replaceAll('"', "&quot;"));
          expect(markdown).toContain(line);
        }

        expect(html).toContain('<button type="button" class="copy"');
        expect(html).toContain("<script>");
        expect(html).toContain("<pre><code>");
        expect(html).not.toContain("__COPY_SCRIPT__");
        expect(markdown).not.toContain("<button");
        expect(markdown).not.toContain("<script");
        expect(markdown).toContain("```text\nCheck my setup");
      })
    )
);

it.effect(
  "keeps the copy buttons hidden until the script runs, and the prompt visible without it",
  () =>
    withLiveInterest((handler) =>
      Effect.gen(function* withoutScript() {
        const html = yield* text(yield* tokenmaxxPage(handler, "text/html"));

        const buttons = [
          ...html.matchAll(
            /<button type="button" class="copy(?: copy-primary)?"[^>]*>/gu
          ),
        ];

        expect(buttons).toHaveLength(3);

        for (const [button] of buttons) {
          expect(button).toContain(" hidden");
        }

        expect(html).toContain("<pre><code>Check my setup");
      })
    )
);

it.effect(
  "allows the copy script by hash only and never unsafe-inline scripts",
  () =>
    withLiveInterest((handler) =>
      Effect.gen(function* strictPolicy() {
        const response = yield* tokenmaxxPage(handler, "text/html");
        const html = yield* text(response);
        const policy = response.headers.get("content-security-policy") ?? "";

        const scriptSrc =
          /script-src (?<sources>[^;]*)/u.exec(policy)?.groups?.sources ?? "";

        const body =
          /<script>(?<body>[\s\S]*?)<\/script>/u.exec(html)?.groups?.body ?? "";

        expect(body.length).toBeGreaterThan(0);
        expect(scriptSrc).toContain(`'sha256-${yield* sha256Base64(body)}'`);
        expect(scriptSrc).not.toContain("unsafe-inline");
        expect(scriptSrc).not.toContain("unsafe-eval");
        expect(policy).toContain("default-src 'none'");
      })
    )
);

it.effect("offers a labeled prompt for a consent-first agent application", () =>
  withLiveInterest((handler) =>
    Effect.gen(function* pagePrompt() {
      const html = yield* text(yield* tokenmaxxPage(handler, "text/html"));

      const markdown = yield* text(
        yield* tokenmaxxPage(handler, "text/markdown")
      );

      expect(html).toContain('aria-label="Copy for agent"');
      expect(html).toContain('<span class="copy-label">Copy for agent</span>');
      expect(html).toContain("Submit only after I approve it.");
      expect(html).toMatch(
        /<a href="https:\/\/ratstack\.sh\/tokenmaxx"[^>]*>workshop page<\/a>/u
      );
      expect(html).toContain("Answer five questions; most are optional.");
      expect(markdown).toContain("Submit only after I approve it.");
    })
  )
);

it.effect(
  "gives agents next actions and links, and humans the clean page",
  () =>
    withLiveInterest((handler) =>
      Effect.gen(function* agentLinks() {
        const html = yield* text(yield* tokenmaxxPage(handler, "text/html"));

        const markdown = yield* text(
          yield* tokenmaxxPage(handler, "text/markdown")
        );

        for (const link of [
          "/llms.txt",
          "/lore/lauren-tan",
          "/lore/poteto-lauren-tan-2500-prs-dune",
          "/lore/lauren-tan-skills",
          "/lore/matt-pocock-skills",
        ]) {
          expect(markdown).toContain(`](${link})`);
        }

        expect(markdown).toContain("Apply through your agent");
        expect(html).not.toContain("Next actions for an agent");
        expect(html).toContain("Apply through your agent");
      })
    )
);

it.effect(
  "serves the approval card, five questions and ticket only to agents",
  () =>
    withLiveInterest((handler) =>
      Effect.gen(function* applicationViews() {
        const html = yield* text(yield* tokenmaxxPage(handler, "text/html"));

        const markdown = yield* text(
          yield* tokenmaxxPage(handler, "text/markdown")
        );

        for (const question of [
          "What are you building?",
          "What do you run today?",
          "What do you want to leave with?",
          "May we email you about the workshop?",
          "Separately, may Joel share your email with selected attendees?",
        ]) {
          expect(markdown).toContain(question);
          expect(html).not.toContain(question);
        }

        for (const instruction of [
          "Question 5 defaults to no.",
          "Never inspect their machine to answer them.",
          'Mark each skipped answer as "skipped" on the card',
          "Show the exact JSON payload alongside the card.",
          "after any edit, ask for approval again.",
          "If contact permission is not true, do not submit.",
          "Confirmation is not a seat.",
          "https://ratstack.sh/mcp",
          "https://ratstack.sh/api/joinInterest",
          "rat-stack joinInterest",
          '"consent": { "contact": true, "share": false }',
        ]) {
          expect(markdown).toContain(instruction);
          expect(html).not.toContain(instruction);
        }

        expect(markdown).not.toContain("__INTAKE_PAGE_TICKET__");
        expect(html).not.toContain("__INTAKE_PAGE_TICKET__");
        expect(markdown).not.toContain("There is no agent path yet.");
        expect(markdown).not.toContain(
          "Joining the list is a person's step in a browser"
        );
      })
    )
);
