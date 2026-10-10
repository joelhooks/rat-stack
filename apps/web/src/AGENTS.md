# Foldkit UI

These rules cover browser code under `apps/web/src/client/`, `features/`, `dev/client/`, and `dev/features/`. Server and infrastructure modules follow the root `AGENTS.md`.

## Keep one direction of data flow

- Define the Model with Effect Schema. The Model owns browser state; the server owns durable facts.
- Define Messages together with `defineMessageUnion`. Keep constructors on their union and match every variant.
- Name Messages after facts: `UpdatedQuery`, `SubmittedSearch`, `SucceededRead`, and `FailedRead`.
- Keep `init`, `update`, and `view` pure. `update` returns the next Model and optional Commands.
- Put I/O in named `Command.define` definitions. A Command returns a result Message, including a typed failure Message.
- Read time, randomness, navigation, clipboard, and DOM effects inside Command execution.
- Pass the typed HTML builder as the last view argument. Thread it through view helpers.
- Keep runtime boot separate from definitions so tests can import them without starting the app.
- Keep credentials and private data out of the Model, Messages, and Command arguments.
- Keep browser lifecycles in Foldkit `update`. When one grows past a few states, use the `foldkit/experimental` `Machine`. Never import XState into browser code; XState machines own server, deploy, and capability lifecycles.

## Map the existing folders

| Home | Responsibility |
| --- | --- |
| `client/docs/model.ts` and `client/docs/message.ts` | Document browser Model, read and search state, and Messages |
| `client/docs/command.ts` | Named Commands and their result Messages |
| `client/docs/queries.ts` | `RpcClient` over the contract group, used by the document browser Commands |
| `client/entry.ts` | Browser runtime boot |
| `features/app.ts` | Document-browser Submodel: `/search` route transitions, update, boot, and view |
| `features/route.ts` | Schema route union and URL parsing for `/search?q=` and `/search?id=` |
| `features/reader*.ts` | Pure document rendering and reader controls |
| `client/reader/model.ts` and `client/reader/message.ts` | Reader flags, clipboard Model, and Messages |
| `client/reader/update.ts` | Pure reader transitions |
| `client/reader/init.ts` and `client/reader/command.ts` | Server and browser initialization and named clipboard Commands |
| `server/` and `entry.server.ts` | Server rendering and RPC forwarding; never import them into browser features |
| `website.ts` | Cloudflare composition through Alchemy's `Cloudflare.Website.Foldkit`; the deployed Worker is the entry `@foldkit/vite-plugin` generates from `entry.server.ts`. Never import it into browser features |

The reader receives generated content as flags. Its local Model tracks clipboard availability and copy status. Its Messages pass through `client/reader/update.ts`; its view lives in `features/reader.ts`. Test those interactions at that pair. The document browser is a Submodel of the reader program, mounted only on `/search`. The reader build gives that page a `docs` flag; `client/reader/update.ts` folds `GotDocsMessage` into it, `features/reader.ts` renders its slot, and `client/entry.ts` provides `DocumentQueries` as the runtime's `resources`. The browser boot reads `location` with `ReadLocation`, so `/search?q=` preloads matches and a submitted search replaces the URL. A match links to its `routePath` reader page. Test the browser through `features/app.ts` update and view, and the mounted route through the reader update and view (`test/docs.scene.test.ts`).

A feature never performs transport. It reads the Model and sends Messages; `update` returns named Commands. A Command calls an Effect `RpcClient` built from the contracts' `toRpcGroup` and returns a result Message. Remote state lives in the Model, as Foldkit `AsyncData` or a `foldkit/experimental` `Query`. Foldkit has no Atom layer.

## Conventions checked against Foldkit 0.167.0

- Use full names such as `Message` and constructors such as `Message.SubmittedSearch()`.
- Use `defineTaggedUnion` for domain state and `defineRouteUnion` for routes.
- Use `Option` for absent Model values. Omit absent `commands` and `outMessage` fields in Foldkit return records.
- Return `{ model }` when there are no Commands. Pass computed Commands through without testing whether they are empty.
- Use `modifyFields` for new immutable Model updates. Keep existing behavior changes separate from convention cleanup.
- Keep child result records together. Use Foldkit's child-fold helpers when composing Submodels and OutMessages.
- Use stable Model identifiers for list keys. Never key rows by position or displayed text.
- Use `h.empty` for an empty branch. Use exhaustive union matches for state-dependent views.
- Use Foldkit `Dom` for DOM effects and Effect APIs for time and randomness.
- Use `Subscription.persistentEntry` with `Dom.streamFromKeyBindings` for keyboard subscriptions.
- Use `@foldkit/ui` render helpers for buttons, inputs, and textareas. Pass the feature's builder last. Render their attribute groups through `toView`; keep our classes and accessible names.
- SSR and SSG use `ssr.clientEntry`, with CSS imports in that browser entry. Export `renderDocument` from `entry.server.ts`; use `Server.renderDocument` with trusted metadata and favicon `head` markup. Keep one title, canonical link, and Open Graph URL. There is no source `index.html` or browser shell transform.
- Bind each update result to its operation name and read its fields through dot access. Use `Update.combine` for dependent steps and `Update.withOutMessage` for an existing result.
- The root no-comments rule wins over upstream section comments and `NOTE` comments.
- StyleX and the root hot-pink rule remain the styling contract. Do not add Tailwind or foldcn.

## Prove behavior with Story and Scene

- Story sends Messages through `update` and asserts on the Model and Commands.
- Scene drives the real view through accessible roles, names, and text.
- Prefer generated inputs and Message histories when the input space varies.
- Plant a plausible wrong transition and observe the test fail.
- Put page-owned behavior at the feature seam. Keep routing and parent composition in app-level tests.
- Use named imports from `foldkit/story` or `foldkit/scene`. Use namespaces when a file needs both.
- Tests run under `@effect/vitest`. Use `it.effect` for Effect behavior; never start a manual Effect runtime in tests.
- Existing tests live under `apps/web/test/`; keep that runner layout. Name new files for their style, such as `docs.story.test.ts` and `docs.scene.test.ts`.

## Refresh after a Foldkit bump

Refresh these conventions in the same change as a Foldkit bump. Dependency changes need owner sign-off.

1. Read the installed version from `apps/web/node_modules/foldkit/package.json`.
2. Read `packages/create-foldkit-app/templates/base/FOLDKIT.md` at `foldkit@<installed-version>` in [Foldkit](https://github.com/foldkit/foldkit).
3. For a canary, resolve the commit named by the installed version instead of using a release tag.
4. Check examples and API signatures at that same revision. Installed source wins over drifting online prose.
5. Refresh the conventions above. Preserve this project's folders, privacy rules, styling, and test runner.
6. Omit scaffolder ownership, subtree installation, and upstream dependency instructions.
7. Update the checked version and `PROVENANCE.md`. Run `pnpm turbo run check test build`.

Reference: [FOLDKIT.md at foldkit@0.167.0](https://github.com/foldkit/foldkit/blob/foldkit%400.167.0/packages/create-foldkit-app/templates/base/FOLDKIT.md). API source and examples live in `packages/foldkit/src/` and `examples/` at that tag.
