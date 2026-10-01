import { expect, it } from "@effect/vitest";
import {
  CAPTURE_ANSWER,
  CONSENT_LINE,
  CONSENT_VERSION,
  InterestDirectory,
  InterestMode,
  InterestTokens,
  RecordedMail,
  digestsMatch,
  postShibaMailerLayer,
  recordingMailerLayer,
} from "@rat-stack/core/interest";
import { Effect, Layer, Redacted, Schema } from "effect";
import type { Context } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import * as HttpRouter from "effect/unstable/http/HttpRouter";

import { mischiefRoutes, toolkitProjection } from "../src/app.js";
import {
  capabilities,
  contentCapabilities,
} from "../src/capabilities/index.js";
import {
  llmsText,
  publicPaths,
  searchContent,
  sitemapXml,
} from "../src/content.js";
import { interestCapabilities } from "../src/interest/handlers.js";
import type {
  NativeRateLimitBinding,
  RateLimitBindings,
} from "../src/rate-limits.js";
import { rateLimitsFrom } from "../src/rate-limits.js";
import {
  PASSING_SHIELD_TOKEN,
  fakeShieldLayer,
} from "./fixtures/fake-shield.js";
import { TestSandbox } from "./test-sandbox.js";

type WebHandler = (request: Request) => Promise<Response>;

const allowing: NativeRateLimitBinding = {
  // oxlint-disable-next-line typescript/promise-function-async -- Cloudflare's binding returns a native Promise.
  limit: () => Promise.resolve({ success: true }),
};

const countingLimit = (allowed: number) => {
  const keys: string[] = [];

  const binding: NativeRateLimitBinding = {
    // oxlint-disable-next-line typescript/promise-function-async -- Cloudflare's binding returns a native Promise.
    limit: ({ key }) => {
      keys.push(key);

      return Promise.resolve({ success: keys.length <= allowed });
    },
  };

  return { binding, keys };
};

const bindingsWith = (interest: NativeRateLimitBinding): RateLimitBindings => ({
  API_PER_IP: allowing,
  EXECUTE_GLOBAL: allowing,
  EXECUTE_PER_IP: allowing,
  INTEREST_PER_IP: interest,
});

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

const recordingServices = (mode: "capture" | "doi") =>
  Layer.mergeAll(
    InterestDirectory.memory,
    InterestTokens.layer(tokenSecret),
    InterestMode.layer(mode),
    fakeShieldLayer,
    recordingMailerLayer
  );

const withInterest = <A, E, R>(
  use: (
    handler: WebHandler,
    services: Context.Context<RecordedMail>
  ) => Effect.Effect<A, E, R>,
  options: {
    readonly limit?: NativeRateLimitBinding;
    readonly mode?: "capture" | "doi";
    readonly operator?: boolean;
  } = {}
) =>
  Effect.scoped(
    Effect.gen(function* interestHandler() {
      const services = yield* Layer.build(
        recordingServices(options.mode ?? "doi")
      );

      const { dispose, handler } = HttpRouter.toWebHandler(
        mischiefRoutes({
          interest: {
            operatorToken:
              options.operator === false ? undefined : operatorToken,
            services,
          },
          rateLimits: rateLimitsFrom(bindingsWith(options.limit ?? allowing)),
        }).pipe(Layer.provide(TestSandbox)),
        { disableLogger: true }
      );

      yield* Effect.addFinalizer(() => Effect.promise(dispose));

      return yield* use(handler, services);
    })
  );

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

const call = (handler: WebHandler, request: Request) =>
  Effect.promise(handler.bind(undefined, request));

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

it.effect(
  "serves the workshop page unlisted, noindex, with a form that posts to the site",
  () =>
    withInterest((handler) =>
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
          "form-action 'self'"
        );
        expect(html).toContain('<meta name="robots" content="noindex"');
        expect(html).toContain(
          '<form method="post" action="/tokenmaxx/interest">'
        );
        expect(html).toContain('name="website"');
        expect(html).toContain("how to burn a trillion tokens");
        expect(html).toContain(
          'Email me once when the date is set for "how to burn a trillion tokens."'
        );
        expect(html).toContain("Join the interest list");
        expect(html).not.toContain("Tell me when the date is set");
        expect(html).toContain('<h2 id="interested">Interested?</h2>');
        expect(html).toContain("Your email");
      })
    )
);

it.effect(
  "keeps the workshop page out of the sitemap, llms.txt, search, and the lore index",
  () =>
    Effect.sync(() => {
      expect(publicPaths).not.toContain("/tokenmaxx");
      expect(sitemapXml("https://ratstack.sh")).not.toContain("tokenmaxx");
      expect(llmsText("https://ratstack.sh")).not.toContain("tokenmaxx");
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
    withInterest((handler) =>
      Effect.gen(function* servesMarkdown() {
        const response = yield* call(
          handler,
          new Request("https://ratstack.sh/tokenmaxx", {
            headers: { accept: "text/markdown" },
          })
        );

        const markdown = yield* text(response);

        expect(response.headers.get("content-type")).toContain("text/markdown");
        expect(markdown).toContain("# 🐀 how to burn a trillion tokens");
        expect(markdown).not.toContain("<form");
      })
    )
);

it.effect("serves the credited screenshot", () =>
  withInterest((handler) =>
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
  "answers every valid address with the same page, whatever its state",
  () =>
    withInterest((handler, services) =>
      Effect.gen(function* sameAnswer() {
        const fresh = yield* call(
          handler,
          form("/tokenmaxx/interest", { email: "reader@example.com" })
        );

        const freshBody = yield* text(fresh);
        const mailAfterFresh = (yield* sent(services)).length;

        const pending = yield* call(
          handler,
          form("/tokenmaxx/interest", { email: "Reader@Example.com " })
        );

        const pendingBody = yield* text(pending);
        const link = linkIn((yield* sent(services))[0]?.text ?? "");

        yield* call(
          handler,
          form("/tokenmaxx/confirm", {
            token: decodeURIComponent(link.split("token=")[1] ?? ""),
          })
        );

        const confirmed = yield* call(
          handler,
          form("/tokenmaxx/interest", { email: "reader@example.com" })
        );

        const confirmedBody = yield* text(confirmed);

        expect(mailAfterFresh).toBe(1);
        expect((yield* sent(services)).length).toBe(1);
        expect([fresh.status, pending.status, confirmed.status]).toEqual([
          200, 200, 200,
        ]);
        expect(pendingBody).toBe(freshBody);
        expect(confirmedBody).toBe(freshBody);
        expect(freshBody).toContain("Check your email for a link to confirm.");
      })
    )
);

it.effect(
  "answers the same page for a rate-limited IP and sends nothing",
  () => {
    const limit = countingLimit(0);

    return withInterest(
      (handler, services) =>
        Effect.gen(function* limited() {
          const answered = yield* call(
            handler,
            form(
              "/tokenmaxx/interest",
              { email: "limited@example.com" },
              "198.51.100.9"
            )
          );

          expect(answered.status).toBe(200);
          expect(yield* text(answered)).toContain(
            "Check your email for a link to confirm."
          );
          expect(yield* sent(services)).toHaveLength(0);
          expect(limit.keys).toEqual(["198.51.100.9"]);
        }),
      { limit: limit.binding }
    );
  }
);

it.effect(
  "stops each IP at the per-IP limit while another IP still gets its email",
  () => {
    const limit = countingLimit(2);

    return withInterest(
      (handler, services) =>
        Effect.gen(function* perIp() {
          for (const name of ["a", "b", "c"]) {
            yield* call(
              handler,
              form("/tokenmaxx/interest", { email: `${name}@example.com` })
            );
          }

          expect((yield* sent(services)).map(({ to }) => to)).toEqual([
            "a@example.com",
            "b@example.com",
          ]);
        }),
      { limit: limit.binding }
    );
  }
);

it.effect(
  "ignores a filled honeypot without sending or recording anything",
  () =>
    withInterest((handler, services) =>
      Effect.gen(function* honeypot() {
        const answered = yield* call(
          handler,
          form("/tokenmaxx/interest", {
            email: "bot@example.com",
            website: "https://spam.example",
          })
        );

        expect(answered.status).toBe(200);
        expect(yield* text(answered)).toContain(
          "Check your email for a link to confirm."
        );
        expect(yield* sent(services)).toHaveLength(0);
      })
    )
);

it.effect(
  "sends one email inside the cooldown however many times the form is posted",
  () =>
    withInterest((handler, services) =>
      Effect.gen(function* cooldown() {
        for (let index = 0; index < 3; index += 1) {
          yield* call(
            handler,
            form("/tokenmaxx/interest", { email: "again@example.com" })
          );
        }

        expect(yield* sent(services)).toHaveLength(1);
      })
    )
);

it.effect("refuses an address that is not an email with a plain message", () =>
  withInterest((handler, services) =>
    Effect.gen(function* invalid() {
      const answered = yield* call(
        handler,
        form("/tokenmaxx/interest", { email: "not an address" })
      );

      expect(answered.status).toBe(422);
      expect(yield* text(answered)).toContain(
        "does not look like an email address"
      );
      expect(yield* sent(services)).toHaveLength(0);
    })
  )
);

it.effect(
  "sends the approved email with the confirm link as the only substitution",
  () =>
    withInterest((handler, services) =>
      Effect.gen(function* approvedEmail() {
        yield* call(
          handler,
          form("/tokenmaxx/interest", { email: "reader@example.com" })
        );
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
    withInterest((handler, services) =>
      Effect.gen(function* confirmFlow() {
        yield* call(
          handler,
          form("/tokenmaxx/interest", { email: "reader@example.com" })
        );
        const [mail] = yield* sent(services);
        const link = linkIn(mail?.text ?? "");
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
  withInterest((handler, services) =>
    Effect.gen(function* tampered() {
      yield* call(
        handler,
        form("/tokenmaxx/interest", { email: "reader@example.com" })
      );
      const [mail] = yield* sent(services);

      const token = decodeURIComponent(
        linkIn(mail?.text ?? "").split("token=")[1] ?? ""
      );

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
        "<h1>This link isn't valid</h1>"
      );
    })
  )
);

it.effect(
  "keeps the operator read off without a token and behind it with one",
  () =>
    Effect.gen(function* operatorRead() {
      const off = yield* withInterest(
        (handler) =>
          call(handler, new Request("https://ratstack.sh/operator/interest")),
        { operator: false }
      );

      const closed = yield* withInterest((handler) =>
        call(handler, new Request("https://ratstack.sh/operator/interest"))
      );

      expect([off.status, closed.status]).toEqual([404, 401]);
    })
);

it.effect(
  "serves the same capability as JSON, answering the same sentence",
  () =>
    withInterest((handler, services) =>
      Effect.gen(function* jsonProjection() {
        const answered = yield* call(
          handler,
          new Request("https://ratstack.sh/api/registerInterest", {
            body: JSON.stringify({ email: "json@example.com" }),
            headers: { "content-type": "application/json" },
            method: "POST",
          })
        );

        expect(answered.status).toBe(200);
        expect(yield* Effect.promise(answered.json.bind(answered))).toEqual({
          message: "Check your email for a link to confirm.",
        });
        expect(yield* sent(services)).toHaveLength(1);
      })
    )
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
        interestNames
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
            fakeShieldLayer,
            postShibaMailerLayer({
              apiKey: Redacted.make("not-a-real-key"),
              cluster: "cluster",
              enabled: false,
              team: "team",
            }).pipe(Layer.provide(fakeHttp))
          )
        );

        const { dispose, handler } = HttpRouter.toWebHandler(
          mischiefRoutes({ interest: { services } }).pipe(
            Layer.provide(TestSandbox)
          ),
          { disableLogger: true }
        );

        yield* Effect.addFinalizer(() => Effect.promise(dispose));

        const answered = yield* call(
          handler,
          form("/tokenmaxx/interest", { email: "quiet@example.com" })
        );

        expect(answered.status).toBe(200);
        expect(yield* text(answered)).toContain(
          "Check your email for a link to confirm."
        );
        expect(postedMailRequests).toHaveLength(0);

        const retried = yield* call(
          handler,
          form("/tokenmaxx/interest", { email: "quiet@example.com" })
        );

        expect(retried.status).toBe(200);
      })
    )
);

it.effect("compares operator tokens by digest", () =>
  Effect.gen(function* digests() {
    expect(yield* digestsMatch("a", "a")).toBe(true);
    expect(yield* digestsMatch("a", "b")).toBe(false);
  })
);

it.effect("answers a submission with the approved sentence", () =>
  withInterest((handler) =>
    Effect.gen(function* answer() {
      const page = yield* call(
        handler,
        form("/tokenmaxx/interest", { email: "reader@example.com" })
      );

      const html = visible(yield* text(page));

      expect(html).toContain("<h1>Check your email</h1>");
      expect(html).toContain("<p>Check your email for a link to confirm.</p>");
      expect(html).not.toContain("Back to the workshop page");
      expect(html).toMatch(
        /<main>\s*<!---->\s*<h1>Check your email<\/h1>\s*<p>Check your email for a link to confirm\.<\/p>\s*<!----><\/main>/u
      );
    })
  )
);

it.effect("renders the four confirm pages with the approved copy", () =>
  withInterest((handler, services) =>
    Effect.gen(function* confirmPages() {
      yield* call(
        handler,
        form("/tokenmaxx/interest", { email: "reader@example.com" })
      );
      const [mail] = yield* sent(services);
      const link = linkIn(mail?.text ?? "");
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
        tokens.sign({ address: "reader@example.com", expiresAt: 1 })
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
        expect(html).toContain("<h1>This link has expired</h1>");
        expect(html).toContain(
          "<p>Confirmation links expire in 72 hours. Return to the signup form to request a new link.</p>"
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
        expect(html).toContain("<h1>This link isn't valid</h1>");
        expect(html).toContain(
          "<p>Return to the signup form to request a confirmation link.</p>"
        );
        expect(html).toContain(
          '<a href="/tokenmaxx#interested">Return to signup</a>'
        );
      }
    })
  )
);

const capturing = { mode: "capture" } as const;

const submission = (
  email: string,
  headers: Readonly<Record<string, string>> = {}
) =>
  new Request("https://ratstack.sh/tokenmaxx/interest", {
    body: new URLSearchParams({
      email,
      shield_shiba_token: PASSING_SHIELD_TOKEN,
    }).toString(),
    headers: {
      "cf-connecting-ip": "203.0.113.50",
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "capture-test-agent/1.0",
      ...headers,
    },
    method: "POST",
  });

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

it.effect("shows the consent line the capture records evidence against", () =>
  withInterest((handler) =>
    Effect.gen(function* consentLine() {
      const html = visible(
        yield* text(
          yield* call(
            handler,
            new Request("https://ratstack.sh/tokenmaxx", {
              headers: { accept: "text/html" },
            })
          )
        )
      );

      expect(html).toContain(CONSENT_LINE);
      expect(html).not.toContain("We build agent harnesses, not apps");
      expect(html).toContain(
        "We build a strong harness that raises the floor for your apps."
      );
      expect(CONSENT_VERSION).toBe("interest-consent-v1");
    })
  )
);

it.effect(
  "captures a new address without sending mail and answers with the capture line",
  () =>
    withInterest(
      (handler, services) =>
        Effect.gen(function* captureRegistration() {
          const html = yield* call(handler, submission("capture@example.com"));
          const body = visible(yield* text(html));

          const jsonAnswer = yield* call(
            handler,
            new Request("https://ratstack.sh/api/registerInterest", {
              body: JSON.stringify({
                email: "capture-json@example.com",
                shieldToken: PASSING_SHIELD_TOKEN,
              }),
              headers: { "content-type": "application/json" },
              method: "POST",
            })
          );

          expect(html.status).toBe(200);
          expect(body).toContain(
            "<p>Thanks. We'll email you a link to confirm.</p>"
          );
          expect(yield* json(jsonAnswer)).toEqual({ message: CAPTURE_ANSWER });
          expect(CAPTURE_ANSWER).toBe(
            "Thanks. We'll email you a link to confirm."
          );
          expect(yield* sent(services)).toEqual([]);

          const summary = yield* json(
            yield* call(handler, operatorGet("/operator/interest"))
          );

          expect(summary).toEqual({ captured: 2, confirmed: [], pending: 0 });
        }),
      capturing
    )
);

it.effect(
  "answers every capture-mode submission with the same page, whatever its state",
  () =>
    withInterest(
      (handler) =>
        Effect.gen(function* identicalCaptureAnswer() {
          const answers = [
            yield* call(handler, submission("same@example.com")),
            yield* call(handler, submission("same@example.com")),
            yield* call(handler, submission("SAME@example.com")),
            yield* call(handler, submission("other@example.com")),
            yield* call(
              handler,
              form("/tokenmaxx/interest", {
                email: "bot@example.com",
                website: "filled",
              })
            ),
          ];

          const bodies = yield* Effect.all(
            answers.map((answer) => text(answer))
          );

          expect(answers.map((answer) => answer.status)).toEqual([
            200, 200, 200, 200, 200,
          ]);
          expect(new Set(bodies).size).toBe(1);
        }),
      capturing
    )
);

it.effect(
  "keeps the first capture on a repeat submission and records no raw IP or user agent",
  () =>
    withInterest(
      (handler) =>
        Effect.gen(function* captureEvidence() {
          yield* call(handler, submission("evidence@example.com"));
          yield* call(
            handler,
            submission("EVIDENCE@example.com", {
              "cf-connecting-ip": "198.51.100.77",
              "user-agent": "another-agent/2.0",
            })
          );
          yield* call(handler, submission("second@example.com"));

          const all = yield* captures(handler);

          const first = all.find(
            ({ address }) => address === "evidence@example.com"
          );

          const second = all.find(
            ({ address }) => address === "second@example.com"
          );

          expect(all).toHaveLength(2);
          expect(first?.consentVersion).toBe(CONSENT_VERSION);
          expect(first?.submissionId).toMatch(/^[0-9a-f-]{36}$/u);
          expect(first?.capturedAt).toBeGreaterThan(0);
          expect(first?.ipHash).toMatch(/^[0-9a-f]{64}$/u);
          expect(first?.uaHash).toMatch(/^[0-9a-f]{64}$/u);
          expect(first?.ipHash).not.toBe(first?.uaHash);
          expect(first?.ipHash).toBe(second?.ipHash);
          expect(first?.uaHash).toBe(second?.uaHash);
          expect(first?.submissionId).not.toBe(second?.submissionId);

          const raw = JSON.stringify(all);

          for (const value of [
            "203.0.113.50",
            "198.51.100.77",
            "capture-test-agent",
            "another-agent",
          ]) {
            expect(raw).not.toContain(value);
          }
        }),
      capturing
    )
);

it.effect("hashes different IPs and user agents to different values", () =>
  withInterest(
    (handler) =>
      Effect.gen(function* differentHashes() {
        yield* call(handler, submission("a@example.com"));
        yield* call(
          handler,
          submission("b@example.com", {
            "cf-connecting-ip": "198.51.100.77",
            "user-agent": "another-agent/2.0",
          })
        );

        const [a, b] = yield* captures(handler);

        expect(a?.ipHash).not.toBe(b?.ipHash);
        expect(a?.uaHash).not.toBe(b?.uaHash);
      }),
    capturing
  )
);

it.effect(
  "shows the invalid-link page for every confirm request in capture mode",
  () =>
    withInterest(
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
            expect(html).toContain("<h1>This link isn't valid</h1>");
            expect(html).toContain(
              "<p>Return to the signup form to request a confirmation link.</p>"
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
  withInterest(
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
    withInterest(
      (handler) =>
        Effect.gen(function* deleteCaptures() {
          yield* call(handler, submission("one@example.com"));
          yield* call(handler, submission("two@example.com"));
          yield* call(handler, submission("three@example.com"));

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

          const again = yield* call(handler, submission("one@example.com"));

          expect(again.status).toBe(200);
          expect(
            (yield* captures(handler)).map(({ address }) => address)
          ).toContain("one@example.com");
        }),
      capturing
    )
);
