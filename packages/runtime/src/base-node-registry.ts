import type { Node, NodeType } from "@dafthunk/types";

import type { ExecutableNode } from "./node-types";
import { MultiStepNode } from "./node-types";

export interface NodeImplementationConstructor<Env = unknown> {
  new (node: Node, env?: Env): ExecutableNode;
  readonly nodeType: NodeType;
}

/**
 * A set of node implementations shipped outside the core registry. Plugins are
 * ordinary modules bundled at build time; nothing is loaded at runtime.
 */
export interface NodePlugin<Env = unknown> {
  /** Stable identifier, used in errors to name the plugin at fault. */
  readonly id: string;
  readonly nodes: readonly NodeImplementationConstructor<Env>[];
}

/**
 * Abstract base class for node registries that provides common functionality
 * for managing node implementations and node operations.
 */
export abstract class BaseNodeRegistry<Env = unknown> {
  protected implementations: Map<string, NodeImplementationConstructor<Env>> =
    new Map();

  public constructor(
    protected env: Env,
    protected developerMode: boolean
  ) {
    this.registerNodes();
  }

  /**
   * Abstract method that each registry must implement to register its specific nodes
   */
  protected abstract registerNodes(): void;

  /**
   * Register a node implementation
   */
  public registerImplementation(
    Implementation: NodeImplementationConstructor<Env>
  ): void {
    if (!Implementation?.nodeType?.type) {
      throw new Error("NodeType is not defined");
    }
    this.implementations.set(Implementation.nodeType.type, Implementation);
  }

  /**
   * Register every node of a plugin. A node type that is already registered —
   * built-in or from an earlier plugin — is rejected rather than replaced, and
   * the whole plugin is checked before any of its nodes is registered, so a
   * rejected plugin leaves the registry untouched.
   */
  public registerPlugin(plugin: NodePlugin<Env>): void {
    const seen = new Set<string>();
    for (const Implementation of plugin.nodes) {
      const type = Implementation?.nodeType?.type;
      if (!type) {
        throw new Error(`Plugin "${plugin.id}": a node has no NodeType`);
      }
      if (this.implementations.has(type) || seen.has(type)) {
        throw new Error(
          `Plugin "${plugin.id}": node type "${type}" is already registered`
        );
      }
      seen.add(type);
    }
    for (const Implementation of plugin.nodes) {
      this.implementations.set(Implementation.nodeType.type, Implementation);
    }
  }

  /**
   * Create an executable node instance from a node definition
   */
  public createExecutableNode(node: Node): ExecutableNode | undefined {
    const Implementation = this.implementations.get(node.type);
    if (!Implementation) {
      return undefined;
    }
    return new Implementation(node, this.env);
  }

  /**
   * Get all available node types
   */
  public getNodeTypes(): NodeType[] {
    return Array.from(this.implementations.values()).map(
      (implementation) => implementation.nodeType
    );
  }

  /**
   * Check if a node type extends MultiStepNode (manages its own durable steps)
   */
  public isMultiStep(type: string): boolean {
    const Implementation = this.implementations.get(type);
    if (!Implementation) return false;
    return Implementation.prototype instanceof MultiStepNode;
  }

  /**
   * Get a specific node type by its type string
   */
  public getNodeType(nodeType: string): NodeType {
    const Implementation = this.implementations.get(nodeType);
    if (!Implementation) {
      throw new Error(`Node type not found: ${nodeType}`);
    }
    return Implementation.nodeType;
  }
}
