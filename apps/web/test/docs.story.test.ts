import { expect, it } from "@effect/vitest";
import { Option, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import { Command, given, message, model, story } from "foldkit/story";
import { fromString } from "foldkit/url";

import { ReplaceUrl, SearchDocs } from "../src/client/docs/command.js";
import { Message } from "../src/client/docs/message.js";
import { SearchState } from "../src/client/docs/model.js";
import { update } from "../src/features/app.js";
import { AppRoute, parseRoute } from "../src/features/route.js";
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
      Command.expectHas(SearchDocs({ generation: 1, query: firstQuery })),
      Command.resolve(ReplaceUrl, Message.CompletedNavigate()),
      Command.resolve(
        SearchDocs,
        Message.SucceededSearch({ generation: 1, result: older })
      ),
      message(Message.UpdatedQuery({ value: ` ${secondQuery} ` })),
      message(Message.SubmittedSearch()),
      Command.expectHas(SearchDocs({ generation: 2, query: secondQuery })),
      Command.resolve(ReplaceUrl, Message.CompletedNavigate()),
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

const typedQuery = Arbitrary.schema(
  Schema.String.check(Schema.makeFilter((text) => !/\p{Cs}/u.test(text)))
);

const isUrlArgs = Schema.is(Schema.Struct({ url: Schema.String }));

it.prop(
  "the URL a submitted search writes reopens the same trimmed query",
  { query: typedQuery },
  ({ query }) => {
    const submitted = update(
      update(docsHome, Message.UpdatedQuery({ value: query })).model,
      Message.SubmittedSearch()
    );

    const written = (submitted.commands ?? []).flatMap((command) =>
      command.name === "ReplaceUrl" && isUrlArgs(command.args)
        ? [command.args.url]
        : []
    );

    if (query.trim().length === 0) {
      expect(written).toStrictEqual([]);

      return;
    }

    expect(written).toHaveLength(1);

    const reopened = parseRoute(
      Option.getOrThrow(fromString(`https://ratstack.sh${written[0] ?? ""}`))
    );

    expect(reopened).toStrictEqual(
      AppRoute.Search({ q: Option.some(query.trim()) })
    );
  }
);
