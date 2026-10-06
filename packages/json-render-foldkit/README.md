# json-render Foldkit adapter

A framework adapter for `@json-render/core@0.21.0` and Foldkit Html. The product catalog and styling belong to the caller.

## One render

```text
Spec + current Model → upstream resolution → typed registry → Foldkit Html
                                                │
                               resolved actions → named Message → update
```

Use `schema.createCatalog(...)` to declare components and actions. `Components<typeof catalog, Msg>` checks each component\u0027s props and Message type. `createRenderer<typeof catalog, Msg>(catalog, components, messageForActions)` returns `(spec, model, h) => Html`.

Each component receives `props`, `children`, `bindings`, `on(event)` and `h`. The registry props parser runs after upstream expression resolution. `on(event)` constructs a Message from resolved actions. It never dispatches effects during render. Foldkit event attributes send that Message to the caller\u0027s update function.

Model is the only state snapshot. The adapter never writes it. State, item, index, binding and visibility resolution use upstream helpers. For actions, `$item` means a state path; for props, it means an item value. Missing streamed nodes and cycles stop that branch. Invalid resolved props produce an alert. Validate complete submissions with the catalog before installing them into Model.

## Scope

- No product packages, StyleX, persistence, network or ambient state.
- Default child slot, repeats, native visibility, state reads and action Messages.
- The caller owns action execution, confirmation, effects and streaming transport.
- Named slots, watchers and custom computed functions are not implemented.
- Upstream supplies `catalog.prompt()`, `catalog.jsonSchema()` and streaming patch helpers.

The adapter structure follows upstream Solid. See the repository\u0027s `PROVENANCE.md`.
