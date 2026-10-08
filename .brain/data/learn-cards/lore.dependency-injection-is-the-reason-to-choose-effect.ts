import { Context, Effect, Layer } from "effect";

export class Mailer extends Context.Service<
  Mailer,
  { readonly send: (to: string) => Effect.Effect<void> }
>()("myapp/Mailer") {
  static readonly layer = Layer.succeed(
    Mailer,
    Mailer.of({ send: (to) => Effect.log(`mail sent to ${to}`) })
  );

  static readonly test = Layer.succeed(
    Mailer,
    Mailer.of({ send: () => Effect.void })
  );
}

const welcome = Effect.gen(function* welcomeJoel() {
  const mailer = yield* Mailer;
  yield* mailer.send("joel@example.com");
});

export const main = welcome.pipe(Effect.provide(Mailer.layer));

export const inTests = welcome.pipe(Effect.provide(Mailer.test));
