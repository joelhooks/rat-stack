# ratstack

Learn [rat-stack](https://ratstack.sh) one concept at a time, without a checkout.

`ratstack` runs the local learn commands and an MCP server. Progress and display preferences stay in `~/.rat-learn` on your machine. Set `RAT_LEARN_DIRECTORY` to use another directory. The public concept deck comes from `https://ratstack.sh`.

## Commands

```sh
npx ratstack learnNext
npx ratstack learnRecord --event '{"conceptId":"lore.context-and-requirements","kind":"shown"}'
npx ratstack learnPreferences
npx ratstack learnSetPreferences --width wide
npx ratstack mcp
```

`npx ratstack --help` lists every command and flag.

## MCP

Add the server to an MCP client:

```json
{ "command": "npx", "args": ["-y", "ratstack", "mcp"] }
```

The server exposes the local learn tools only.

## Source

Built from [`apps/cli`](https://github.com/joelhooks/rat-stack/tree/main/apps/cli) and published from CI with npm provenance. `THIRD_PARTY_LICENSES.md` lists the bundled packages and their licenses.
