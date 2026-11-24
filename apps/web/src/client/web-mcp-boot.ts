import type { WebMcpContext } from "@rat-stack/capability/web-mcp";
import { Effect } from "effect";
import type { Cause } from "effect";

declare global {
  interface Document {
    readonly modelContext?: WebMcpContext;
  }

  interface Navigator {
    readonly modelContext?: WebMcpContext;
  }
}

export const installReaderTools = () => {
  const context = document.modelContext ?? navigator.modelContext;

  if (context === undefined) {
    return;
  }

  const enter = () => {
    const controller = new AbortController();
    const { signal } = controller;

    window.addEventListener(
      "pagehide",
      (event) => {
        controller.abort();

        if (event.persisted) {
          window.addEventListener("pageshow", enter, { once: true });
        }
      },
      { once: true }
    );

    const onRegistrationError = (error: Cause.UnknownError) =>
      Effect.logWarning("WebMCP tools could not register.", error).pipe(
        Effect.andThen(
          Effect.sync(() => {
            controller.abort();
          })
        )
      );

    Effect.runFork(
      Effect.tryPromise(() => import("./web-mcp.js")).pipe(
        Effect.flatMap(({ registerReaderTools }) =>
          registerReaderTools(context, signal)
        ),
        Effect.andThen(Effect.never),
        Effect.scoped,
        Effect.tapError(onRegistrationError),
        Effect.ignore
      ),
      { signal }
    );
  };

  enter();
};
