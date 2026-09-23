/**
 * Plugins let a deployment add nodes without editing the core registry. The
 * contract that matters: a plugin node is resolvable exactly like a built-in
 * one, and a plugin can never silently replace a node that is already there —
 * a collision fails loudly, names the plugin, and registers nothing from it.
 */

import type { Node, NodeExecution, NodeType } from "@dafthunk/types";
import { describe, expect, it } from "vitest";

import { BaseNodeRegistry, type NodePlugin } from "./base-node-registry";
import type { NodeContext } from "./node-types";
import { ExecutableNode } from "./node-types";

const type = (id: string): NodeType =>
  ({
    id,
    name: id,
    type: id,
    description: "",
    tags: [],
    icon: "x",
    inputs: [],
    outputs: [{ name: "value", type: "string" }],
  }) as NodeType;

class BuiltInNode extends ExecutableNode {
  static readonly nodeType = type("built-in");

  async execute(): Promise<NodeExecution> {
    return this.createSuccessResult({ value: "built-in" });
  }
}

class PluginNode extends ExecutableNode {
  static readonly nodeType = type("plugin-node");

  async execute(): Promise<NodeExecution> {
    return this.createSuccessResult({ value: "from plugin" });
  }
}

class ImpostorNode extends ExecutableNode {
  static readonly nodeType = type("built-in");

  async execute(): Promise<NodeExecution> {
    return this.createSuccessResult({ value: "impostor" });
  }
}

class Registry extends BaseNodeRegistry {
  protected registerNodes(): void {
    this.registerImplementation(BuiltInNode);
  }
}

const node = (nodeType: string): Node =>
  ({ id: "n1", name: "n1", type: nodeType, inputs: [], outputs: [] }) as never;

describe("BaseNodeRegistry.registerPlugin", () => {
  it("makes a plugin node listed, resolvable and executable", async () => {
    const registry = new Registry({}, false);
    registry.registerPlugin({ id: "acme", nodes: [PluginNode] });

    expect(registry.getNodeTypes().map((t) => t.type)).toContain("plugin-node");
    const executable = registry.createExecutableNode(node("plugin-node"));
    expect(executable).toBeInstanceOf(PluginNode);
    const result = await (executable as PluginNode).execute({
      inputs: {},
    } as NodeContext);
    expect(result.outputs).toEqual({ value: "from plugin" });
  });

  it("rejects a node type that collides with a built-in, naming the plugin, and registers none of its nodes", () => {
    const registry = new Registry({}, false);
    const plugin: NodePlugin = {
      id: "acme",
      nodes: [PluginNode, ImpostorNode],
    };

    expect(() => registry.registerPlugin(plugin)).toThrow(
      'Plugin "acme": node type "built-in" is already registered'
    );
    expect(registry.createExecutableNode(node("built-in"))).toBeInstanceOf(
      BuiltInNode
    );
    expect(registry.createExecutableNode(node("plugin-node"))).toBeUndefined();
  });

  it("rejects a plugin that declares the same node type twice", () => {
    const registry = new Registry({}, false);

    expect(() =>
      registry.registerPlugin({ id: "acme", nodes: [PluginNode, PluginNode] })
    ).toThrow('Plugin "acme": node type "plugin-node" is already registered');
    expect(registry.createExecutableNode(node("plugin-node"))).toBeUndefined();
  });

  it("rejects a second plugin that reuses a type from an earlier one", () => {
    const registry = new Registry({}, false);
    registry.registerPlugin({ id: "first", nodes: [PluginNode] });

    expect(() =>
      registry.registerPlugin({ id: "second", nodes: [PluginNode] })
    ).toThrow('Plugin "second": node type "plugin-node" is already registered');
  });
});
