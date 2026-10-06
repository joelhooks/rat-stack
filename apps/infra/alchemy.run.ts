import * as Alchemy from "alchemy";
import { adopt } from "alchemy/AdoptPolicy";
import * as Cloudflare from "alchemy/Cloudflare";
import { retain } from "alchemy/RemovalPolicy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import Mischief from "../mischief/src/worker.js";
import { Website } from "../web/src/website.js";

export default Alchemy.Stack(
  "RatStack",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* stack() {
    const dev = yield* Alchemy.ALCHEMY_DEV;

    if (!dev) {
      const zone = yield* Cloudflare.Zone.Zone("RatstackZone", {
        name: "ratstack.sh",
      }).pipe(adopt(true), retain());

      const dnsAidService = (
        id: string,
        name:
          | `_a2a._agents.${string}`
          | `_index._agents.${string}`
          | `_mcp._agents.${string}`
      ) =>
        Cloudflare.DNS.Record(id, {
          content: {
            priority: 1,
            target: "ratstack.sh.",
            value: 'mandatory="alpn,port" alpn="h2" port="443"',
          },
          name,
          ttl: 3600,
          type: "SVCB",
          zoneId: zone.zoneId,
        }).pipe(retain());

      yield* dnsAidService("DnsAidIndexSvcb", "_index._agents.ratstack.sh");
      yield* dnsAidService("DnsAidA2aSvcb", "_a2a._agents.ratstack.sh");
      yield* dnsAidService("DnsAidMcpSvcb", "_mcp._agents.ratstack.sh");
      yield* Cloudflare.DNS.Record("DnsAidIndexTxt", {
        content: '"agents=rat-stack:mcp,rat-stack:a2a"',
        name: "_index._agents.ratstack.sh",
        ttl: 3600,
        type: "TXT",
        zoneId: zone.zoneId,
      }).pipe(retain());

      yield* Cloudflare.DNS.Record("PostShibaDkimCname", {
        content: "174.customers.postshiba.com",
        name: "ps1._domainkey.ratstack.sh",
        proxied: false,
        ttl: 3600,
        type: "CNAME",
        zoneId: zone.zoneId,
      }).pipe(retain());

      yield* Cloudflare.DNS.Record("PostShibaReturnPathCname", {
        content: "rp.postshiba.com",
        name: "rp.ratstack.sh",
        proxied: false,
        ttl: 3600,
        type: "CNAME",
        zoneId: zone.zoneId,
      }).pipe(retain());

      yield* Cloudflare.DNS.Record("DmarcTxt", {
        content: '"v=DMARC1; p=none;"',
        name: "_dmarc.ratstack.sh",
        ttl: 3600,
        type: "TXT",
        zoneId: zone.zoneId,
      }).pipe(retain());

      const forwardTo = yield* Config.schema(
        Schema.Redacted(Schema.NonEmptyString),
        "EMAIL_FORWARD_TO"
      );

      const routing = yield* Cloudflare.Email.Routing("RatstackEmailRouting", {
        zone: zone.zoneId,
      }).pipe(retain());

      const address = yield* Cloudflare.Email.Address(
        "WorkshopForwardAddress",
        {
          email: Redacted.value(forwardTo),
        }
      ).pipe(retain());

      yield* Cloudflare.Email.Rule("WorkshopForwardRule", {
        actions: [{ type: "forward", value: [address.email] }],
        enabled: true,
        matchers: [
          { field: "to", type: "literal", value: "workshop@ratstack.sh" },
        ],
        name: "workshop",
        zone: routing.zoneId,
      }).pipe(retain());

      yield* Cloudflare.DNS.Dnssec("RatstackDnssec", {
        status: "active",
        zoneId: zone.zoneId,
      }).pipe(adopt(true), retain());
    }

    const mischief = yield* Mischief;
    const website = yield* Website;

    return { mischiefUrl: mischief.url, websiteUrl: website.url };
  })
);
