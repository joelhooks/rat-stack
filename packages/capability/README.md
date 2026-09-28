# Capability sandbox

`layerSubprocess` uses a restricted Node `vm` context as defense in depth for agent-written code, not as a security boundary for hostile code; authorized capabilities can still reach the network, so untrusted code belongs in the Worker-loader sandbox.

# HTTP routes and middleware

`toHttpApi` serves a contract with an `http` route at that method and path; each `:name` path segment reads the input field of that name. Without `http`, a contract answers `POST /<name>` with a JSON body.

Middleware passed as `toHttpApi(id, capabilities, { middleware })` is trusted host code. It runs around every route before the route decodes its input, so it may answer on its own, for example a 401 or a maintenance response, without the input being read. It may also turn a handler's failure into a response. Keep two duties in the contract rather than in middleware:

- Input leniency belongs in the input schema. A middleware that rewrites decode refusals changes only the body of a refusal, not what the route accepts.
- A failure's wire shape belongs in the contract's failure schema. A middleware that renders failures encodes them through that schema, so undeclared fields are dropped, and it lets any failure the schema does not match fall through to the default encoder, which answers 500. `test/problem-status.ts` is that pattern.
