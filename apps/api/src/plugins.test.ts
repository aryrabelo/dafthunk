import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { Bindings } from "./context";
import { CloudflareNodeRegistry } from "./runtime/cloudflare-node-registry";

describe("nodePlugins", () => {
  it("puts the CNB WhatsApp template node in the deployed catalog", () => {
    const registry = new CloudflareNodeRegistry(env as Bindings, false);

    expect(registry.getNodeTypes().map((t) => t.type)).toContain(
      "cnb-whatsapp-template"
    );
  });
});
