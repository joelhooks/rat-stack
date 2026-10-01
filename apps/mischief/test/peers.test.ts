import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { Arbitrary } from "effect/unstable/arbitrary";

import {
  partitionPeers,
  peerPins,
  PeerRow,
  renderPeers,
} from "../scripts/peers.ts";

it.prop(
  "tier views preserve every row and order each view by tier then repo",
  { peers: Arbitrary.schema(Schema.Array(PeerRow)) },
  ({ peers }) => {
    const before = [...peers];
    const { tailing, alsoSeen } = partitionPeers(peers);
    const combined = [...tailing, ...alsoSeen];
    expect(combined).toHaveLength(peers.length);

    for (const peer of peers) {
      expect(combined.filter((row) => row === peer)).toHaveLength(
        peers.filter((row) => row === peer).length
      );
    }

    expect(tailing.every((peer) => ["S", "A", "B"].includes(peer.tier))).toBe(
      true
    );
    expect(
      alsoSeen.every((peer) => ["C", "D", "E", "F"].includes(peer.tier))
    ).toBe(true);

    for (const view of [tailing, alsoSeen]) {
      for (const [index, peer] of view.entries()) {
        const next = view[index + 1];

        if (next) {
          expect("SABCDEF".indexOf(peer.tier)).toBeLessThanOrEqual(
            "SABCDEF".indexOf(next.tier)
          );

          if (peer.tier === next.tier) {
            expect(peer.repo.localeCompare(next.repo)).toBeLessThanOrEqual(0);
          }
        }
      }
    }

    expect(peers).toEqual(before);
  }
);

it.prop(
  "manifest bumps change the rendered comparison without editing peer rows",
  { effect: Arbitrary.schema(Schema.Literals(["4.0.0", "4.0.0-rc.117"])) },
  ({ effect }) => {
    const pins = peerPins(
      JSON.stringify({ devDependencies: { effect } }),
      JSON.stringify({ dependencies: { alchemy: "2.0.0-beta.79" } }),
      JSON.stringify({
        dependencies: {
          "@xstate/effect": "0.1.0-alpha.2",
          xstate: "6.0.0-alpha.59",
        },
      })
    );

    const row = Schema.decodeUnknownSync(PeerRow)({
      branch: "main",
      checked: "2026-10-01",
      commit: "abc123",
      firstSeen: "2026-09-23",
      reason: "Shared manifests",
      repo: "example/peer",
      sources: [{ label: "root", path: "package.json" }],
      studied: "Not yet studied",
      tier: "B",
      versions: {
        alchemy: "2.0.0-beta.79",
        effect: "4.0.0-rc.117",
        xstate: "—",
        xstateEffect: "—",
      },
    });

    const markdown = renderPeers(
      "<PeerPins />\n<PeerRoster />\n<PeersAlsoSeen />\n<PeerSources />",
      [row],
      pins
    );

    expect(markdown).toContain(`| ${effect} | 2.0.0-beta.79 |`);
    expect(markdown).toContain(
      `4.0.0-rc.117 ${effect === "4.0.0-rc.117" ? "=" : "≠"}`
    );
    expect(markdown).toContain("<summary>Also seen: C–F (0 peers)</summary>");
    expect(markdown).toContain(
      "https://github.com/example/peer/blob/abc123/package.json"
    );

    const annotated = renderPeers(
      "<PeerRoster />\n<PeersAlsoSeen />",
      [
        {
          ...row,
          versions: {
            ...row.versions,
            effect: `${effect} (workspace override)`,
          },
        },
        {
          ...row,
          tier: "C",
          versions: { ...row.versions, xstate: "6.0.0-alpha.59" },
        },
      ],
      pins
    );

    const [roster, alsoSeen] = annotated.split("<details>");

    expect(roster).not.toContain("| XState |");
    expect(roster).not.toContain("| @xstate/effect |");
    expect(alsoSeen).toContain("| XState |");
    expect(alsoSeen).not.toContain("| @xstate/effect |");
    expect(roster).toContain("¹ workspace override");
    expect(roster).not.toContain("(workspace override)");
    expect(roster).toContain(`${effect} =¹`);
    expect(roster).toContain(
      "Drift: = matches our pin; ≠ differs from our pin."
    );
    expect(alsoSeen).toContain(
      "Drift: = matches our pin; ≠ differs from our pin."
    );
  }
);
