import { expect, it } from "@effect/vitest";
import {
  InterestDirectory,
  InterestTokens,
  RecordedMail,
  digestsMatch,
  postShibaMailerLayer,
  recordingMailerLayer,
} from "@rat-stack/core/interest";
import { Effect, Layer, Redacted } from "effect";
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

const recordingServices = Layer.mergeAll(
  InterestDirectory.memory,
  InterestTokens.layer(tokenSecret),
  recordingMailerLayer
);

const withInterest = <A, E, R>(
  use: (
    handler: WebHandler,
    services: Context.Context<RecordedMail>
  ) => Effect.Effect<A, E, R>,
  options: {
    readonly limit?: NativeRateLimitBinding;
    readonly operator?: boolean;
  } = {}
) =>
  Effect.scoped(
    Effect.gen(function* interestHandler() {
      const services = yield* Layer.build(recordingServices);

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

        expect(beforeBody).toEqual({ confirmed: [], pending: 1 });
        expect(afterPrompt).toEqual({ confirmed: [], pending: 1 });
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
