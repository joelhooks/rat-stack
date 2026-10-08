import {
  Clock,
  Context,
  DateTime,
  Effect,
  Layer,
  Result,
  Schema,
} from "effect";
import { Base64Url } from "effect/encoding";

import { AuthService as Auth } from "./auth-service.js";
import { feedbackClientId, feedbackScope } from "./feedback-plugin.js";
import { Unauthenticated } from "./unauthenticated.js";

const Grant = Schema.Struct({
  expiresAt: Schema.Finite,
  id: Schema.String,
  personId: Schema.String,
});

const Claims = Schema.Struct({
  audience: Schema.Literal("learnFeedback"),
  grant: Grant,
  scope: Schema.Literal(feedbackScope),
});

const DeviceRecord = Schema.Struct({
  clientId: Schema.String,
  expiresAt: Schema.Date,
  id: Schema.String,
  lastPolledAt: Schema.optional(Schema.NullOr(Schema.Date)),
  pollingInterval: Schema.Finite.check(Schema.isGreaterThan(0)),
  scope: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.Literals(["pending", "approved", "denied"]),
  userId: Schema.optional(Schema.NullOr(Schema.String)),
});

const FeedbackData = Schema.Struct({
  cardId: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(200)),
  feedback: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(2000)),
  personId: Schema.String.check(Schema.isNonEmpty()),
});

const encoder = new TextEncoder();

const denied = () =>
  new Unauthenticated({
    message:
      "Approve a new feedback device code. This credential authorizes learnFeedback only.",
  });

const encodeClaims = Schema.encodeEffect(Schema.fromJsonString(Claims));

const decodeClaims = Schema.decodeUnknownEffect(Schema.fromJsonString(Claims));

const makeFeedbackIdentity = Effect.gen(function* makeFeedbackIdentity() {
  const auth = yield* Auth;

  const loadContext = Effect.fn("FeedbackIdentity.context")(
    function* loadContext() {
      const instance = yield* auth.auth;

      return yield* Effect.promise(
        // oxlint-disable-next-line typescript/promise-function-async -- Better Auth and Web Crypto own native Promises at this adapter boundary.
        () => instance.$context
      );
    }
  );

  const key = Effect.fn("FeedbackIdentity.key")(function* key() {
    const context = yield* loadContext();

    return yield* Effect.promise(
      // oxlint-disable-next-line typescript/promise-function-async -- Better Auth and Web Crypto own native Promises at this adapter boundary.
      () =>
        crypto.subtle.importKey(
          "raw",
          encoder.encode(`learn-feedback:v1:${context.secret}`),
          { hash: "SHA-256", name: "HMAC" },
          false,
          ["sign", "verify"]
        )
    );
  });

  const readDevice = Effect.fn("FeedbackIdentity.readDevice")(
    function* readDevice(field: "id" | "deviceCode", value: string) {
      const context = yield* loadContext();

      const raw = yield* Effect.promise(
        // oxlint-disable-next-line typescript/promise-function-async -- Better Auth and Web Crypto own native Promises at this adapter boundary.
        () =>
          context.adapter.findOne({
            model: "deviceCode",
            where: [{ field, value }],
          })
      );

      return raw === null
        ? null
        : yield* Schema.decodeUnknownEffect(DeviceRecord)(raw).pipe(
            Effect.orDie
          );
    }
  );

  const request = auth.api
    .deviceCode({ body: { client_id: feedbackClientId, scope: feedbackScope } })
    .pipe(
      Effect.orDie,
      Effect.map((result) => ({
        deviceCode: result.device_code,
        expiresIn: result.expires_in,
        interval: result.interval,
        userCode: result.user_code,
        verificationUrl: result.verification_uri_complete,
      }))
    );

  const inspectDevice = Effect.fn("FeedbackIdentity.inspectDevice")(
    function* inspectDevice(code: string) {
      const device = yield* readDevice("deviceCode", code);

      if (
        device === null ||
        device.clientId !== feedbackClientId ||
        device.scope !== feedbackScope
      ) {
        return yield* denied();
      }

      const now = yield* Clock.currentTimeMillis;
      const interval = device.pollingInterval;

      if (device.expiresAt.getTime() <= now) {
        return { interval: interval / 1000, state: "expired" } as const;
      }

      if (device.status === "denied") {
        return { interval: interval / 1000, state: "denied" } as const;
      }

      if (
        device.lastPolledAt !== undefined &&
        device.lastPolledAt !== null &&
        now - device.lastPolledAt.getTime() < interval
      ) {
        return { interval: interval / 1000, state: "polled-too-fast" } as const;
      }

      const context = yield* loadContext();
      yield* Effect.promise(
        // oxlint-disable-next-line typescript/promise-function-async -- Better Auth and Web Crypto own native Promises at this adapter boundary.
        () =>
          context.adapter.update({
            model: "deviceCode",
            update: { lastPolledAt: DateTime.toDate(DateTime.makeUnsafe(now)) },
            where: [{ field: "id", value: device.id }],
          })
      );

      if (device.status === "approved") {
        if (device.userId === undefined || device.userId === null) {
          return yield* denied();
        }

        return {
          grant: {
            expiresAt: device.expiresAt.getTime(),
            id: device.id,
            personId: device.userId,
          },
          state: "approved",
        } as const;
      }

      return { interval: interval / 1000, state: "pending" } as const;
    }
  );

  const issue = Effect.fn("FeedbackIdentity.issue")(function* issue(
    grant: typeof Grant.Type
  ) {
    const device = yield* readDevice("id", grant.id);
    const now = yield* Clock.currentTimeMillis;

    if (
      device === null ||
      device.status !== "approved" ||
      device.scope !== feedbackScope ||
      device.clientId !== feedbackClientId ||
      device.userId !== grant.personId ||
      device.expiresAt.getTime() !== grant.expiresAt ||
      grant.expiresAt <= now
    ) {
      return yield* denied();
    }

    const payload = yield* encodeClaims({
      audience: "learnFeedback",
      grant,
      scope: feedbackScope,
    }).pipe(Effect.orDie);

    const signingKey = yield* key();

    const signature = yield* Effect.promise(
      // oxlint-disable-next-line typescript/promise-function-async -- Better Auth and Web Crypto own native Promises at this adapter boundary.
      () => crypto.subtle.sign("HMAC", signingKey, encoder.encode(payload))
    );

    return `lf1.${Base64Url.encode(payload)}.${Base64Url.encode(new Uint8Array(signature))}`;
  });

  const inspectCredential = Effect.fn("FeedbackIdentity.inspectCredential")(
    function* inspectCredential(token: string, capability: string) {
      const invalid = { state: "unauthenticated" } as const;

      if (capability !== "learnFeedback") {
        return invalid;
      }

      const [prefix, encodedPayload, encodedSignature, ...rest] =
        token.split(".");

      if (
        prefix !== "lf1" ||
        encodedPayload === undefined ||
        encodedSignature === undefined ||
        rest.length !== 0
      ) {
        return invalid;
      }

      const payload = Result.getOrUndefined(
        Base64Url.decodeString(encodedPayload)
      );

      const signature = Result.getOrUndefined(
        Base64Url.decode(encodedSignature)
      );

      if (
        payload === undefined ||
        signature === undefined ||
        Base64Url.encode(payload) !== encodedPayload ||
        Base64Url.encode(signature) !== encodedSignature
      ) {
        return invalid;
      }

      const signingKey = yield* key();

      const valid = yield* Effect.promise(
        // oxlint-disable-next-line typescript/promise-function-async -- Better Auth and Web Crypto own native Promises at this adapter boundary.
        () =>
          crypto.subtle.verify(
            "HMAC",
            signingKey,
            new Uint8Array(signature),
            encoder.encode(payload)
          )
      );

      if (!valid) {
        return invalid;
      }

      const decoded = yield* decodeClaims(payload).pipe(Effect.result);

      if (Result.isFailure(decoded)) {
        return invalid;
      }

      const { grant } = decoded.success;
      const now = yield* Clock.currentTimeMillis;

      if (grant.expiresAt <= now) {
        return { state: "expired" } as const;
      }

      const device = yield* readDevice("id", grant.id);

      if (
        device === null ||
        device.status !== "approved" ||
        device.scope !== feedbackScope ||
        device.clientId !== feedbackClientId ||
        device.userId !== grant.personId ||
        device.expiresAt.getTime() !== grant.expiresAt
      ) {
        return invalid;
      }

      const context = yield* loadContext();

      const person = yield* Effect.promise(
        // oxlint-disable-next-line typescript/promise-function-async -- Better Auth and Web Crypto own native Promises at this adapter boundary.
        () => context.internalAdapter.findUserById(grant.personId)
      );

      return person === null
        ? invalid
        : ({ personId: grant.personId, state: "active" } as const);
    }
  );

  const save = Effect.fn("FeedbackIdentity.save")(function* save(
    personId: string,
    cardId: string,
    feedback: string
  ) {
    const parsed = yield* Schema.decodeEffect(FeedbackData)({
      cardId,
      feedback,
      personId,
    }).pipe(Effect.orDie);

    const context = yield* loadContext();
    const now = yield* Clock.currentTimeMillis;

    const result = yield* Effect.promise(
      // oxlint-disable-next-line typescript/promise-function-async -- Better Auth and Web Crypto own native Promises at this adapter boundary.
      () =>
        context.adapter.create({
          data: {
            ...parsed,
            createdAt: DateTime.toDate(DateTime.makeUnsafe(now)),
          },
          model: "learnFeedback",
        })
    );

    return yield* Schema.decodeUnknownEffect(
      Schema.Struct({ id: Schema.String })
    )(result).pipe(Effect.orDie);
  });

  return { inspectCredential, inspectDevice, issue, request, save };
});

type FeedbackIdentityService = Effect.Success<typeof makeFeedbackIdentity>;

// @effect-diagnostics-next-line leakingRequirements:off -- Provider operations retain RuntimeContext until the composition root binds them inside a request.
export class FeedbackIdentity extends Context.Service<
  FeedbackIdentity,
  FeedbackIdentityService
>()("@rat-stack/auth/FeedbackIdentity") {
  static readonly layer = Layer.effect(FeedbackIdentity, makeFeedbackIdentity);
}
