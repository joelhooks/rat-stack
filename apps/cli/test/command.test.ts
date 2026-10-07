import { describe, expect, it } from "@effect/vitest";

import { rootCommand } from "../src/command.js";
import { cliCapabilities } from "../src/surfaces.js";

describe("command registration", () => {
  it("registers every capability by its name", () => {
    const names = rootCommand.subcommands.flatMap((group) =>
      group.commands.map((command) => command.name)
    );

    for (const capability of cliCapabilities) {
      expect(names).toContain(capability.contract.name);
    }

    expect(
      rootCommand.subcommands.flatMap((group) => group.commands)
    ).toHaveLength(cliCapabilities.length + 5);
  });
});
