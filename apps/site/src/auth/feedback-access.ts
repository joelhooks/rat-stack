import { LearnUnauthenticated } from "@rat-stack/core/learn";
import { FeedbackAuthor } from "@rat-stack/learn/feedback";
import { RuntimeContext } from "alchemy";
import type { HttpEffect } from "alchemy/Http";
import { Context, Effect, Layer, Option } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import { feedbackApprovalScript } from "../client/feedback-approval.js";

const unavailable = new LearnUnauthenticated({
  message: "Learn feedback sign-in is disabled.",
});

const unavailableAuthor = FeedbackAuthor.of({
  inspectCredential: () => Effect.succeed({ state: "unauthenticated" }),
  inspectDevice: () => Effect.fail(unavailable),
  issue: () => Effect.fail(unavailable),
  request: Effect.fail(unavailable),
  save: () => Effect.die(new Error("Disabled feedback writer was invoked")),
});

type InRequest<Value> =
  Value extends Effect.Effect<infer A, infer E>
    ? Effect.Effect<A, E, RuntimeContext>
    : Value extends (...args: infer Args) => Effect.Effect<infer A, infer E>
      ? (...args: Args) => Effect.Effect<A, E, RuntimeContext>
      : never;

type FeedbackPort = ReturnType<typeof FeedbackAuthor.of>;

export type FeedbackBackend = {
  readonly [Key in keyof FeedbackPort]: InRequest<FeedbackPort[Key]>;
};

export const feedbackRequests = (identity?: FeedbackBackend) =>
  HttpRouter.middleware(
    (httpEffect) =>
      Effect.gen(function* provideFeedbackAuthor() {
        if (identity === undefined) {
          return yield* httpEffect.pipe(
            Effect.provideService(FeedbackAuthor, unavailableAuthor)
          );
        }

        const requestRuntime = yield* Effect.serviceOption(RuntimeContext);

        if (Option.isNone(requestRuntime)) {
          return yield* Effect.die(
            new Error("Feedback requires a request RuntimeContext")
          );
        }

        const runtime = Context.make(RuntimeContext, requestRuntime.value);

        const author = FeedbackAuthor.of({
          inspectCredential: (token, capability) =>
            identity
              .inspectCredential(token, capability)
              .pipe(Effect.provideContext(runtime)),
          inspectDevice: (code) =>
            identity.inspectDevice(code).pipe(Effect.provideContext(runtime)),
          issue: (grant) =>
            identity.issue(grant).pipe(Effect.provideContext(runtime)),
          request: identity.request.pipe(Effect.provideContext(runtime)),
          save: (personId, cardId, feedback) =>
            identity
              .save(personId, cardId, feedback)
              .pipe(Effect.provideContext(runtime)),
        });

        return yield* httpEffect.pipe(
          Effect.provideService(FeedbackAuthor, author)
        );
      }),
    { global: true }
  );

const approvalHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Approve learn feedback</title></head><body><main>
<h1>Approve learn feedback</h1>
<p>This code grants an agent access to leave feedback on learn cards. It grants no other access.</p>
<p>Only approve a code shown by an agent you asked to leave feedback.</p>
<label for="code">Agent code</label><input id="code" autocomplete="off" maxlength="20">
<form id="signin"><p><label>Name <input name="name" autocomplete="name"></label></p>
<p><label>Email <input name="email" type="email" autocomplete="email" required></label></p>
<p><label>Password <input name="password" type="password" autocomplete="current-password" minlength="8" required></label></p>
<button type="submit" value="signin">Sign in</button> <button type="submit" value="signup">Create account</button></form>
<form id="actions" hidden><button type="submit" value="approve">Approve feedback only</button> <button type="submit" value="deny">Deny</button></form>
<p id="status" role="status" aria-live="polite">Checking sign-in…</p></main><script src="/learn/approve.js" defer></script></body></html>`;

export const feedbackAccess = (
  auth: { readonly fetch: HttpEffect<RuntimeContext> },
  identity: FeedbackBackend
) => ({
  requests: feedbackRequests(identity),
  routes: Layer.mergeAll(
    HttpRouter.add(
      "*",
      "/auth/*",
      Effect.gen(function* authRequest() {
        const requestRuntime = yield* Effect.serviceOption(RuntimeContext);

        if (Option.isNone(requestRuntime)) {
          return yield* Effect.die(
            new Error("Sign-in requires a request RuntimeContext")
          );
        }

        return yield* auth.fetch.pipe(
          Effect.provideService(RuntimeContext, requestRuntime.value)
        );
      })
    ),
    HttpRouter.add(
      "GET",
      "/learn/approve",
      HttpServerResponse.text(approvalHtml, {
        contentType: "text/html; charset=utf-8",
        headers: {
          "cache-control": "no-store",
          "content-security-policy":
            "default-src 'none'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
          "referrer-policy": "no-referrer",
          "x-robots-tag": "noindex",
        },
      })
    ),
    HttpRouter.add(
      "GET",
      "/learn/approve.js",
      HttpServerResponse.text(feedbackApprovalScript, {
        contentType: "text/javascript; charset=utf-8",
        headers: { "cache-control": "no-store" },
      })
    )
  ),
});
