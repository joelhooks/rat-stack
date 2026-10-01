import { expect, it } from "@effect/vitest";
import { IntakeTicket } from "@rat-stack/core/intake";
import {
  CAPTURE_ANSWER,
  SubscriberConfirm,
  REGISTER_ANSWER,
  CONSENT_LINE,
  CONSENT_VERSION,
  InterestDirectory,
  InterestMode,
  InterestTokens,
  RecordedMail,
  digestsMatch,
  recordingMailerLayer,
} from "@rat-stack/core/interest";
import type { ConfirmState, SubscriberIntake } from "@rat-stack/core/interest";
import { postShibaMailerLayer } from "@rat-stack/subscriber-delivery";
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
import { fakeIntake, fakeIntakeLayer } from "./fixtures/fake-intake.js";
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

const recordingServices = (
  mode: "capture" | "doi" | "drovr",
  intake: Layer.Layer<SubscriberIntake>,
  confirm: Layer.Layer<SubscriberConfirm>
) =>
  Layer.mergeAll(
    InterestDirectory.memory,
    InterestTokens.layer(tokenSecret),
    InterestMode.layer(mode),
    intake,
    confirm,
    recordingMailerLayer
  );

const withInterest = <A, E, R>(
  use: (
    handler: WebHandler,
    services: Context.Context<RecordedMail>
  ) => Effect.Effect<A, E, R>,
  options: {
    readonly confirm?: Layer.Layer<SubscriberConfirm>;
    readonly intake?: Layer.Layer<SubscriberIntake>;
    readonly limit?: NativeRateLimitBinding;
    readonly mode?: "capture" | "doi" | "drovr";
    readonly operator?: boolean;
    readonly shieldSiteKey?: string;
  } = {}
) =>
  Effect.scoped(
    Effect.gen(function* interestHandler() {
      const services = yield* Layer.build(
        recordingServices(
          options.mode ?? "doi",
          options.intake ?? fakeIntakeLayer,
          options.confirm ?? SubscriberConfirm.unconfigured
        )
      );

      const { dispose, handler } = HttpRouter.toWebHandler(
        mischiefRoutes({
          interest: {
            operatorToken:
              options.operator === false ? undefined : operatorToken,
            services,
          },
          rateLimits: rateLimitsFrom(bindingsWith(options.limit ?? allowing)),
          shieldSiteKey: options.shieldSiteKey,
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
          '<form class="interest" method="post" action="/tokenmaxx/interest">'
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
        expect(markdown).toContain(
          "# how to burn a trillion tokens and get good results"
        );
        expect(markdown).not.toContain("<form");
      })
    )
);

it.effect("keeps the only rat in the nav brand on the workshop page", () =>
  withInterest((handler) =>
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
        "This link isn't valid</h1>"
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
      expect(html.replaceAll(/<!--[\s\S]*?-->/gu, "")).toMatch(
        /<main(?: [^>]*)?>\s*<h1>Check your email<\/h1>\s*<p>Check your email for a link to confirm\.<\/p>\s*<\/main>/u
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
        expect(html).toContain("This link has expired</h1>");
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
        expect(html).toContain("This link isn't valid</h1>");
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
    body: new URLSearchParams({ email }).toString(),
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
              body: JSON.stringify({ email: "capture-json@example.com" }),
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
            expect(html).toContain("This link isn't valid</h1>");
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

const drovrMode = (script: ReturnType<typeof fakeIntake>) =>
  Effect.gen(function* withScript() {
    const intake = yield* script;

    return {
      ...intake,
      options: { intake: intake.layer, mode: "drovr" } as const,
    };
  });

const widgetSubmission = (
  fields: Readonly<Record<string, string>>,
  headers: Readonly<Record<string, string>> = {}
) =>
  new Request("https://ratstack.sh/tokenmaxx/interest", {
    body: new URLSearchParams(fields).toString(),
    headers: {
      "cf-connecting-ip": "203.0.113.50",
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "drovr-test-agent/1.0",
      ...headers,
    },
    method: "POST",
  });

const tryAgain = "We couldn't verify that. Please try again.";

it.effect(
  "forwards a Shield-checked sign-up to drovr and shows the approved answer",
  () =>
    Effect.gen(function* forwards() {
      const { calls, options } = yield* drovrMode(
        fakeIntake([{ kind: "accepted" }])
      );

      yield* withInterest(
        (handler) =>
          Effect.gen(function* accepted() {
            const response = yield* call(
              handler,
              widgetSubmission({
                email: "Reader@Example.com",
                shield_shiba_token: "challenge-1",
              })
            );

            const html = visible(yield* text(response));
            const [forwarded] = yield* calls;

            expect(response.status).toBe(200);
            expect(html).toContain("<h1>Check your email</h1>");
            expect(html).toContain(`<p>${REGISTER_ANSWER}</p>`);
            expect(REGISTER_ANSWER).toBe(
              "Check your email for a link to confirm."
            );
            expect(forwarded?.challenge).toBe("challenge-1");
            expect(forwarded?.email).toBe("Reader@Example.com");
            expect(forwarded?.submissionId).toMatch(/^[0-9a-f-]{36}$/u);
            expect(forwarded?.clientBucket.ipHash).toMatch(/^[0-9a-f]{64}$/u);
            expect(forwarded?.clientBucket.uaHash).toMatch(/^[0-9a-f]{64}$/u);
            expect(JSON.stringify(forwarded)).not.toContain("203.0.113.50");
            expect(JSON.stringify(forwarded)).not.toContain("drovr-test-agent");
          }),
        options
      );
    })
);

it.effect("mints a fresh submission id per submission", () =>
  Effect.gen(function* freshIds() {
    const { calls, options } = yield* drovrMode(
      fakeIntake([{ kind: "accepted" }])
    );

    yield* withInterest(
      (handler) =>
        Effect.gen(function* twice() {
          for (const email of ["one@example.com", "two@example.com"]) {
            yield* call(
              handler,
              widgetSubmission({ email, shield_shiba_token: "challenge" })
            );
          }

          const [first, second] = yield* calls;

          expect(first?.submissionId).not.toBe(second?.submissionId);
        }),
      options
    );
  })
);

it.effect("retries a 503 with the same submission id and then succeeds", () =>
  Effect.gen(function* retried() {
    const { calls, options } = yield* drovrMode(
      fakeIntake([
        { afterSeconds: 0, kind: "retry" },
        { afterSeconds: 0, kind: "retry" },
        { kind: "accepted" },
      ])
    );

    yield* withInterest(
      (handler) =>
        Effect.gen(function* retrying() {
          const response = yield* call(
            handler,
            widgetSubmission({
              email: "retry@example.com",
              shield_shiba_token: "challenge",
            })
          );

          const all = yield* calls;

          expect(response.status).toBe(200);
          expect(all).toHaveLength(3);
          expect(
            new Set(all.map(({ submissionId }) => submissionId)).size
          ).toBe(1);
        }),
      options
    );
  })
);

it.effect(
  "gives up after the bounded retries and asks the visitor to try again",
  () =>
    Effect.gen(function* exhausted() {
      const { calls, options } = yield* drovrMode(
        fakeIntake([{ afterSeconds: 0, kind: "retry" }])
      );

      yield* withInterest(
        (handler) =>
          Effect.gen(function* exhaustedRetries() {
            const response = yield* call(
              handler,
              widgetSubmission({
                email: "busy@example.com",
                shield_shiba_token: "challenge",
              })
            );

            expect(response.status).toBe(422);
            expect(visible(yield* text(response))).toContain(tryAgain);
            expect(yield* calls).toHaveLength(3);
          }),
        options
      );
    })
);

it.effect("does not wait out a long retry delay", () =>
  Effect.gen(function* longDelay() {
    const { calls, options } = yield* drovrMode(
      fakeIntake([{ afterSeconds: 600, kind: "retry" }])
    );

    yield* withInterest(
      (handler) =>
        Effect.gen(function* refusesLongDelay() {
          const response = yield* call(
            handler,
            widgetSubmission({
              email: "slow@example.com",
              shield_shiba_token: "challenge",
            })
          );

          expect(response.status).toBe(422);
          expect(yield* calls).toHaveLength(1);
        }),
      options
    );
  })
);

it.effect("refuses on any other drovr answer without showing a reason", () =>
  Effect.gen(function* refusedByDrovr() {
    const { calls, options } = yield* drovrMode(
      fakeIntake([{ kind: "refused" }])
    );

    yield* withInterest(
      (handler) =>
        Effect.gen(function* refuses() {
          const response = yield* call(
            handler,
            widgetSubmission({
              email: "no@example.com",
              shield_shiba_token: "challenge",
            })
          );

          const html = visible(yield* text(response));

          expect(response.status).toBe(422);
          expect(html).toContain(tryAgain);
          expect(html).not.toContain("Check your email for a link");
          expect(yield* calls).toHaveLength(1);
        }),
      options
    );
  })
);

it.effect(
  "refuses locally, without calling drovr, when the Shield token is missing",
  () =>
    Effect.gen(function* noToken() {
      const { calls, options } = yield* drovrMode(
        fakeIntake([{ kind: "accepted" }])
      );

      yield* withInterest(
        (handler) =>
          Effect.gen(function* missingToken() {
            const missing = yield* call(
              handler,
              widgetSubmission({ email: "none@example.com" })
            );

            const blank = yield* call(
              handler,
              widgetSubmission({
                email: "none@example.com",
                shield_shiba_token: "  ",
              })
            );

            expect([missing.status, blank.status]).toEqual([422, 422]);
            expect(yield* calls).toEqual([]);
          }),
        options
      );
    })
);

it.effect(
  "answers a missing client address uniformly without calling drovr",
  () =>
    Effect.gen(function* noIp() {
      const { calls, options } = yield* drovrMode(
        fakeIntake([{ kind: "accepted" }])
      );

      yield* withInterest(
        (handler) =>
          Effect.gen(function* missingIp() {
            const request = new Request(
              "https://ratstack.sh/tokenmaxx/interest",
              {
                body: new URLSearchParams({
                  email: "noip@example.com",
                  shield_shiba_token: "challenge",
                }).toString(),
                headers: {
                  "content-type": "application/x-www-form-urlencoded",
                },
                method: "POST",
              }
            );

            const response = yield* call(handler, request);

            expect(response.status).toBe(200);
            expect(visible(yield* text(response))).toContain(REGISTER_ANSWER);
            expect(yield* calls).toEqual([]);
          }),
        options
      );
    })
);

it.effect("short-circuits the honeypot and the rate limit before drovr", () =>
  Effect.gen(function* beforeDrovr() {
    const { calls, options } = yield* drovrMode(
      fakeIntake([{ kind: "accepted" }])
    );

    yield* withInterest(
      (handler) =>
        Effect.gen(function* honeypot() {
          const response = yield* call(
            handler,
            widgetSubmission({
              email: "bot@example.com",
              shield_shiba_token: "challenge",
              website: "filled",
            })
          );

          expect(response.status).toBe(200);
          expect(yield* calls).toEqual([]);
        }),
      options
    );

    yield* withInterest(
      (handler) =>
        Effect.gen(function* limited() {
          const response = yield* call(
            handler,
            widgetSubmission({
              email: "fast@example.com",
              shield_shiba_token: "challenge",
            })
          );

          expect(response.status).toBe(200);
          expect(yield* calls).toEqual([]);
        }),
      { ...options, limit: countingLimit(0).binding }
    );
  })
);

it.effect("refuses an invalid address before calling drovr", () =>
  Effect.gen(function* badAddress() {
    const { calls, options } = yield* drovrMode(
      fakeIntake([{ kind: "accepted" }])
    );

    yield* withInterest(
      (handler) =>
        Effect.gen(function* invalid() {
          const response = yield* call(
            handler,
            widgetSubmission({
              email: "not an address",
              shield_shiba_token: "challenge",
            })
          );

          expect(response.status).toBe(422);
          expect(yield* calls).toEqual([]);
        }),
      options
    );
  })
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

it.effect("sends the email's /confirm link to the confirm page", () =>
  Effect.gen(function* confirmAlias() {
    yield* withInterest(
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
    yield* withInterest(
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
      yield* withInterest(
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
    withInterest(
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

it.effect(
  "embeds the Shield widget and widens the CSP only in drovr mode with a site key",
  () =>
    Effect.gen(function* widget() {
      const page = (handler: WebHandler) =>
        call(
          handler,
          new Request("https://ratstack.sh/tokenmaxx", {
            headers: { accept: "text/html" },
          })
        );

      yield* withInterest(
        (handler) =>
          Effect.gen(function* withKey() {
            const response = yield* page(handler);
            const html = yield* text(response);

            const policy =
              response.headers.get("content-security-policy") ?? "";

            expect(html).toContain(
              '<script src="https://www.postshiba.com/shield/v1/widget.js" async></script>'
            );
            expect(html).toContain(
              '<shield-shiba sitekey="ss_pk_test" email-field="#interest-email"></shield-shiba>'
            );
            expect(policy).toMatch(
              /script-src https:\/\/static\.cloudflareinsights\.com 'sha256-[A-Za-z0-9+/=]+' https:\/\/www\.postshiba\.com;/u
            );
            expect(policy).toContain(
              "connect-src 'self' https://cloudflareinsights.com https://www.postshiba.com https://postshiba.com"
            );
            expect(policy).toContain("worker-src blob:");
          }),
        { mode: "drovr", shieldSiteKey: "ss_pk_test" }
      );

      for (const mode of ["doi", "capture"] as const) {
        yield* withInterest(
          (handler) =>
            Effect.gen(function* withKeyOutsideDrovr() {
              const response = yield* page(handler);
              const html = yield* text(response);

              const policy =
                response.headers.get("content-security-policy") ?? "";

              expect(html).not.toContain("shield-shiba");
              expect(html).not.toContain("__SHIELD_SHIBA_WIDGET__");
              expect(policy).not.toContain("postshiba");
              expect(policy).not.toContain("worker-src");
            }),
          { mode, shieldSiteKey: "ss_pk_test" }
        );
      }

      yield* withInterest(
        (handler) =>
          Effect.gen(function* drovrWithoutKey() {
            const response = yield* page(handler);
            const html = yield* text(response);

            expect(html).not.toContain("shield-shiba");
            expect(
              response.headers.get("content-security-policy") ?? ""
            ).not.toContain("postshiba");
          }),
        { mode: "drovr" }
      );

      yield* withInterest((handler) =>
        Effect.gen(function* withoutKey() {
          const response = yield* page(handler);
          const html = yield* text(response);
          const policy = response.headers.get("content-security-policy") ?? "";

          expect(html).not.toContain("shield-shiba");
          expect(html).not.toContain("__SHIELD_SHIBA_WIDGET__");
          expect(policy).not.toContain("postshiba");
        })
      );
    })
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

    yield* withInterest(
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
  "shows the setup prompt in both views, with the button and script only in HTML",
  () =>
    withInterest((handler) =>
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
    withInterest((handler) =>
      Effect.gen(function* withoutScript() {
        const html = yield* text(yield* tokenmaxxPage(handler, "text/html"));

        const buttons = [
          ...html.matchAll(/<button type="button" class="copy"[^>]*>/gu),
        ];

        expect(buttons).toHaveLength(2);

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
    withInterest((handler) =>
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
  withInterest((handler) =>
    Effect.gen(function* pagePrompt() {
      const html = yield* text(yield* tokenmaxxPage(handler, "text/html"));

      const markdown = yield* text(
        yield* tokenmaxxPage(handler, "text/markdown")
      );

      expect(html).toContain('aria-label="copy this prompt for your agent"');
      expect(html).toContain(
        '<span class="copy-label">copy this prompt for your agent</span>'
      );
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
    withInterest((handler) =>
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
        expect(html).not.toContain("Apply through your agent");
      })
    )
);

it.effect(
  "serves the approval card, five questions and ticket only to agents",
  () =>
    withInterest((handler) =>
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

it.effect("keeps the form's text and field names unchanged", () =>
  withInterest((handler) =>
    Effect.gen(function* formMarkup() {
      const html = yield* text(yield* tokenmaxxPage(handler, "text/html"));

      const markup = /<form [\s\S]*?<\/form>/u.exec(html)?.[0] ?? "";

      expect(markup).toContain('action="/tokenmaxx/interest"');
      expect(markup).toContain('method="post"');
      expect(markup).toContain(
        '<label for="interest-email">Your email</label>'
      );
      expect(markup).toContain('id="interest-email" type="email" name="email"');
      expect(markup).toContain(
        '<label for="interest-website">Leave this empty</label>'
      );
      expect(markup).toContain(
        'id="interest-website" type="text" name="website"'
      );
      expect(markup).toContain("Join the interest list</button>");
      expect(markup).toContain(
        'Email me once when the date is set for "how to burn a trillion tokens."'
      );
    })
  )
);
