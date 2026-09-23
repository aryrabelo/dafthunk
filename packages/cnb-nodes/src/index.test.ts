import { BaseNodeRegistry } from "@dafthunk/runtime";
import type { Node } from "@dafthunk/types";
import { describe, expect, it } from "vitest";

import { CnbWhatsAppTemplateNode } from "./cnb-whatsapp-template-node";
import { cnbPlugin } from "./index";

class PluginOnlyRegistry extends BaseNodeRegistry {
  protected registerNodes(): void {
    this.registerPlugin(cnbPlugin);
  }
}

describe("cnbPlugin", () => {
  it("lists cnb-whatsapp-template and resolves it to the CNB node", () => {
    const registry = new PluginOnlyRegistry({}, false);

    expect(registry.getNodeTypes().map((t) => t.type)).toContain(
      "cnb-whatsapp-template"
    );
    expect(
      registry.createExecutableNode({
        id: "n1",
        name: "n1",
        type: "cnb-whatsapp-template",
        position: { x: 0, y: 0 },
        inputs: [],
        outputs: [],
      } as Node)
    ).toBeInstanceOf(CnbWhatsAppTemplateNode);
  });
});
