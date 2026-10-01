import { Context, Effect, Layer, Ref } from "effect";

export type TicketBinding = "first" | "same" | "other";

export interface TicketBindingStub {
  readonly bindTicket: (
    submissionId: string,
    expiresAt: number
  ) => Effect.Effect<TicketBinding>;
}

export class TicketBindings extends Context.Service<
  TicketBindings,
  {
    readonly bind: (
      nonce: string,
      submissionId: string,
      expiresAt: number
    ) => Effect.Effect<TicketBinding>;
  }
>()("@rat-stack/intake-live/TicketBindings") {
  static readonly memoryLayer = Layer.effect(
    this,
    Effect.gen(function* makeMemoryBindings() {
      const held = yield* Ref.make(new Map<string, string>());

      return {
        bind: (nonce: string, submissionId: string) =>
          Ref.modify(held, (bindings): [TicketBinding, Map<string, string>] => {
            const bound = bindings.get(nonce);

            if (bound === undefined) {
              return ["first", new Map(bindings).set(nonce, submissionId)];
            }

            return [bound === submissionId ? "same" : "other", bindings];
          }),
      };
    })
  );
}

export const doTicketBindings = (stub: (nonce: string) => TicketBindingStub) =>
  Layer.succeed(TicketBindings, {
    bind: (nonce, submissionId, expiresAt) =>
      stub(nonce).bindTicket(submissionId, expiresAt),
  });
