import { Effect } from "effect";

import {
  ReaderBlock,
  ReaderInline,
} from "../../web/src/client/reader-document.ts";
import { readerHomeFlags } from "./reader-home-flags.ts";
import { prepareReaderSiteInputs } from "./reader-site-inputs.ts";

export const readerPromptFlags = Effect.fn("readerPromptFlags")(
  function* readerPromptFlags(origin: string) {
    const inputs = yield* prepareReaderSiteInputs;
    const base = yield* readerHomeFlags(origin);
    const indexPath = "/prompts";
    const index = inputs.pages.find((page) => page.path === indexPath);

    if (index === undefined) {
      return yield* Effect.die(
        new Error("Regenerate the prompt index before preparing reader pages.")
      );
    }

    const common = {
      ...base,
      bibliography: [],
      codeFences: [],
      copyPrompts: [],
      references: undefined,
      snippets: [],
      terms: [],
    };

    const indexMarkdown = `# Prompts\n\nCopyable agent prompts for rat-stack apps.\n\n${inputs.prompts.map((prompt) => `- [${prompt.title}](/prompts/${prompt.slug}): ${prompt.description}`).join("\n")}\n`;

    const indexFlags = {
      ...common,
      agentMarkdown: indexMarkdown,
      blocks: [
        ReaderBlock.Paragraph({
          content: [
            ReaderInline.Text({
              value: "Copyable agent prompts for rat-stack apps.",
            }),
          ],
        }),
        ReaderBlock.List({
          items: inputs.prompts.map((prompt) => [
            ReaderInline.Link({
              href: `/prompts/${prompt.slug}`,
              value: prompt.title,
            }),
            ReaderInline.Text({ value: `: ${prompt.description}` }),
          ]),
        }),
      ],
      heading: "Prompts",
      page: {
        generation: inputs.generation,
        metadata: index.metadata,
        path: indexPath,
        sourcePath: ".brain/resources/prompts",
        status: 200,
      },
    };

    const details = inputs.prompts.map((prompt) => {
      const path = `/prompts/${prompt.slug}`;
      const descriptor = inputs.pages.find((page) => page.path === path);

      if (descriptor === undefined) {
        throw new Error(`Regenerate the prompt descriptor for ${prompt.slug}.`);
      }

      const creditUrl = /https:\/\/\S+/u.exec(prompt.credit)?.[0];

      const credit =
        creditUrl === undefined
          ? [ReaderInline.Text({ value: prompt.credit })]
          : [
              ReaderInline.Text({
                value: prompt.credit.slice(0, prompt.credit.indexOf(creditUrl)),
              }),
              ReaderInline.Link({ href: creditUrl, value: creditUrl }),
            ];

      return {
        ...common,
        agentMarkdown: `# ${prompt.title}\n\n${prompt.description}\n\n${prompt.body}\n\n${prompt.credit}\n`,
        blocks: [
          ReaderBlock.Paragraph({
            content: [ReaderInline.Text({ value: prompt.description })],
          }),
          ReaderBlock.PromptText({ value: prompt.body }),
          ReaderBlock.CopyPrompt({ id: prompt.slug }),
          ReaderBlock.Paragraph({ content: credit }),
        ],
        copyPrompts: [
          { id: prompt.slug, label: "Copy prompt", text: prompt.body },
        ],
        heading: prompt.title,
        page: {
          generation: inputs.generation,
          metadata: descriptor.metadata,
          path,
          sourcePath: prompt.sourcePath,
          status: 200,
        },
      };
    });

    return [indexFlags, ...details];
  }
);
