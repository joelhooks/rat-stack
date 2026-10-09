import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import { Command, given, message, model, story } from "foldkit/story";

import { SearchDocs } from "../src/client/docs.js";
import { Message, SearchState } from "../src/client/model.js";
import { update } from "../src/features/app.js";
import { docsHome, docsResult } from "./docs-fixture.js";

it.prop(
  "search histories retain the latest result when an older completion arrives",
  { query: Arbitrary.schema(Schema.String) },
  ({ query }) => {
    const firstQuery = `first:${query}`.trim();
    const secondQuery = `second:${query}`.trim();
    const older = docsResult("Older result");
    const latest = docsResult("Latest result");

    story(
      update,
      given(docsHome),
      message(Message.UpdatedQuery({ value: ` ${firstQuery} ` })),
      message(Message.SubmittedSearch()),
      Command.expectExact(SearchDocs({ generation: 1, query: firstQuery })),
      Command.resolve(
        SearchDocs,
        Message.SucceededSearch({ generation: 1, result: older })
      ),
      message(Message.UpdatedQuery({ value: ` ${secondQuery} ` })),
      message(Message.SubmittedSearch()),
      Command.expectExact(SearchDocs({ generation: 2, query: secondQuery })),
      Command.resolve(
        SearchDocs,
        Message.SucceededSearch({ generation: 2, result: latest })
      ),
      message(Message.SucceededSearch({ generation: 1, result: older })),
      message(Message.FailedSearch({ generation: 1 })),
      model((current) => {
        expect(current.query).toBe(secondQuery);
        expect(current.search).toStrictEqual(
          SearchState.Loaded({ result: latest })
        );
      }),
      Command.expectNone()
    );
  }
);
