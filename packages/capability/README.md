# Capability sandbox

`layerSubprocess` uses a restricted Node `vm` context as defense in depth for agent-written code, not as a security boundary for hostile code; authorized capabilities can still reach the network, so untrusted code belongs in the Worker-loader sandbox.

# HTTP routes, provide hooks, and failures

`toHttpApi` serves a contract with an `http` route at that method and path. Each `:name` path segment reads the input field of that name, and a segment that names no input field is a type error in `defineContract` (and a throw in `toHttpApi` for contracts only known as `AnyContract`). Without `http`, a contract answers `POST /<name>` with a JSON body.

There is no raw middleware option. A host reaches into a request only through two hooks:

- **`provide`:** a list of `{ tag, failure, from }`. `from(request)` either succeeds with the service for `tag`, which the route's handler then reads, or fails with a value of `failure`, a declared schema that is encoded like any other failure (its `httpApiStatus` annotation is the status, and `HttpApiSchema.encodeToWithHeaders` can add headers such as `WWW-Authenticate`). A hook cannot answer a response. When it succeeds, decode, handler and encode always run. It is the HTTP twin of `CurrentPersonMiddleware` in `packages/auth`. The projection's layer requires whatever the hooks' `from` functions require, and no longer requires the services the hooks provide.
- **`decodeRefusal`:** renders a request the route could not decode (query, params, payload or headers) as the host's own body, through Effect's `HttpApiMiddleware.layerSchemaErrorTransform`. Without it, a decode refusal is Effect's empty 400. It never sees response encoding errors.

A handler's failure leaves only through the contract's failure schema. A union failure answers each member's own `httpApiStatus` (422 when a member has none), and encoding drops fields the member does not declare. A failure the schema does not declare is a 500 with an empty body.
