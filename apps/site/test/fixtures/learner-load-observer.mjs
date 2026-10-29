import { registerHooks } from "node:module";

import { Sandbox } from "@rat-stack/capability/sandbox";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";

const loaded = [];

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith("/packages/learn/dist/learner-service.js")) {
      loaded.push(url);
    }

    return nextLoad(url, context);
  },
});

const { mischiefRoutes } = await import("#built-app");

const { nodeAssetsLayer } = await import("#built-node-content");

const sandbox = Layer.succeed(Sandbox, {
  run: () => Effect.die(new Error("Unexpected sandbox request")),
});

const { handler, dispose } = HttpRouter.toWebHandler(
  mischiefRoutes().pipe(Layer.provide(Layer.merge(nodeAssetsLayer, sandbox))),
  { disableLogger: true }
);

try {
  const requests = await Promise.all(
    ["/", "/news"].flatMap((path) =>
      ["text/html", "text/markdown"].map(async (accept) => {
        const response = await handler(
          new Request(`http://localhost${path}`, { headers: { accept } })
        );

        const body = await response.text();

        return {
          accept,
          characters: body.length,
          loads: loaded.length,
          path,
          status: response.status,
        };
      })
    )
  );

  const response = await handler(
    new Request("http://localhost/api/learnDeck", {
      body: "{}",
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );

  const body = await response.text();

  console.log(
    JSON.stringify({
      learning: {
        characters: body.length,
        loads: loaded.length,
        status: response.status,
      },
      requests,
    })
  );
} finally {
  await dispose();
}
