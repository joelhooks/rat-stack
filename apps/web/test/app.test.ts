import { describe, expect, it } from "@effect/vitest";
import type { ReadOutput } from "@rat-stack/core/contracts";
import { Option, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import * as Scene from "foldkit/scene";
import * as Story from "foldkit/story";
import { fromString } from "foldkit/url";

import { ReadDoc, SearchDocs } from "../src/client/docs.js";
import { Message, Model, ReadState, SearchState } from "../src/client/model.js";
import { init, update, view } from "../src/features/app.js";
import { AppRoute } from "../src/features/route.js";

const home = Model.make({
  generation: 0,
  query: "capability",
  read: ReadState.Idle(),
  route: AppRoute.Home(),
  search: SearchState.Idle(),
});

const document = {
  description: "A shared contract exposes the same behavior on every surface.",
  digest: "fixture",
  id: "lore:one-capability-every-surface",
  kind: "lore",
  routePath: "/lore/one-capability-every-surface",
  sourcePath: ".brain/resources/lore/one-capability-every-surface.svx",
  text: "Define one contract. Project every surface.",
  title: "One capability, every surface",
} satisfies typeof ReadOutput.Type;

const result = {
  matches: [{ ...document, excerpt: document.text, score: 1 }],
  total: 1,
};

const url = (path: string) =>
  Option.getOrThrow(fromString(`https://example.test${path}`));

const readUrl = url(`/read?id=${encodeURIComponent(document.id)}`);

const search = (
  ...steps: readonly Scene.SceneStep<
    typeof Model.Type,
    typeof Message.Type,
    never
  >[]
) => {
  Scene.scene({ update, view }, Scene.given(home), ...steps);
};

describe("document browser", () => {
  it("unknown routes render a return path without fetching a document", () => {
    Scene.scene(
      { update, view },
      Scene.given(init(url("/unknown")).model),
      Scene.Command.expectNone(),
      Scene.expect(Scene.role("heading", { name: "Page not found" })).toExist(),
      Scene.expect(Scene.role("link", { name: "Back to search" })).toHaveAttr(
        "href",
        "/"
      )
    );
  });

  it("a read route without an id explains the missing selection", () => {
    Scene.scene(
      { update, view },
      Scene.given(init(url("/read")).model),
      Scene.expect(Scene.role("alert")).toHaveText("No document was selected."),
      Scene.Command.expectNone()
    );
  });

  it("search input submits a trimmed query and renders linked results", () => {
    search(
      Scene.type(
        Scene.role("textbox", { name: "Search the docs" }),
        " capability "
      ),
      Scene.click(Scene.role("button", { name: "Search" })),
      Scene.Command.expectExact(
        SearchDocs({ generation: 1, query: "capability" })
      ),
      Scene.Command.resolve(
        SearchDocs,
        Message.SucceededSearch({ generation: 1, result })
      ),
      Scene.expect(Scene.text("1 result")).toExist(),
      Scene.expect(Scene.role("link", { name: document.title })).toHaveAttr(
        "href",
        `/read?id=${encodeURIComponent(document.id)}`
      ),
      Scene.expect(Scene.text(document.text)).toExist()
    );
  });

  it("a read route dispatches the capability and renders the document", () => {
    Scene.scene(
      { update, view },
      Scene.given(home),
      Scene.Subscription.emit(Message.ChangedUrl({ url: readUrl })),
      Scene.Command.expectExact(ReadDoc({ generation: 1, id: document.id })),
      Scene.Command.resolve(
        ReadDoc,
        Message.SucceededRead({ document, generation: 1 })
      ),
      Scene.expect(Scene.role("heading", { name: document.title })).toExist(),
      Scene.expect(Scene.text(document.text)).toExist(),
      Scene.expect(Scene.role("link", { name: "← Back to search" })).toHaveAttr(
        "href",
        "/"
      )
    );
  });

  it("failed search renders an alert instead of results", () => {
    search(
      Scene.click(Scene.role("button", { name: "Search" })),
      Scene.Command.resolve(
        SearchDocs,
        Message.FailedSearch({ generation: 1 })
      ),
      Scene.expect(Scene.role("alert")).toHaveText(
        "Search failed. Try again in a moment."
      )
    );
  });

  it("failed read renders an alert and a return link", () => {
    Scene.scene(
      { update, view },
      Scene.given(home),
      Scene.Subscription.emit(Message.ChangedUrl({ url: readUrl })),
      Scene.Command.resolve(
        ReadDoc,
        Message.FailedRead({
          generation: 1,
          message: "Resource missing",
          notFound: true,
        })
      ),
      Scene.expect(Scene.text("Document not found")).toExist(),
      Scene.expect(Scene.role("alert")).toHaveText("Resource missing")
    );
  });

  it("a cold read starts its request without waiting for navigation", () => {
    const initial = init(readUrl);

    expect(initial.model.route).toStrictEqual(
      AppRoute.Read({ id: Option.some(document.id) })
    );
    expect(initial.commands).toHaveLength(1);
    expect(initial.commands?.[0]).toMatchObject({
      args: { generation: 1, id: document.id },
      name: "ReadDoc",
    });
  });

  it("blank search does not request content", () => {
    Story.story(
      update,
      Story.given(home),
      Story.message(Message.UpdatedQuery({ value: "  " })),
      Story.message(Message.SubmittedSearch()),
      Story.Command.expectNone()
    );
  });

  it.prop(
    "every generated Message preserves a schema-valid Model without mutating its input",
    {
      message: Arbitrary.schema(Message),
      model: Arbitrary.schema(Model),
    },
    ({ message, model }) => {
      const encode = Schema.encodeSync(Schema.toCodecJson(Model));
      const before = encode(model);
      const next = update(model, message);

      expect(Schema.is(Model)(next.model)).toBe(true);
      expect(encode(model)).toStrictEqual(before);
    }
  );

  it.prop(
    "late read results cannot replace a newer route",
    {
      generation: Arbitrary.schema(Schema.Int),
      id: Arbitrary.schema(Schema.String),
    },
    ({ generation, id }) => {
      const current = {
        ...home,
        generation,
        route: AppRoute.Read({ id: Option.some(id) }),
      };

      const next = update(
        current,
        Message.SucceededRead({ document, generation: generation - 1 })
      );

      expect(next.model).toBe(current);
    }
  );
});
