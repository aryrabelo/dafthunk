import { cnbPlugin } from "@cnb/dafthunk-nodes";
import type { NodePlugin } from "@dafthunk/runtime";

import type { Bindings } from "./context";

/**
 * Node plugins registered after the built-in nodes, in order. Each plugin is a
 * module bundled at build time; a node type that collides with a built-in or
 * with an earlier plugin fails registration with an error naming the plugin.
 *
 * A deployment adds its own nodes here without touching the core registry:
 *
 *   import { myPlugin } from "@acme/dafthunk-nodes";
 *   export const nodePlugins: readonly NodePlugin<Bindings>[] = [myPlugin];
 */
export const nodePlugins: readonly NodePlugin<Bindings>[] = [cnbPlugin];
