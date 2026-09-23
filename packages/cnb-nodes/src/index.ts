import type { NodePlugin } from "@dafthunk/runtime";

import { CnbWhatsAppTemplateNode } from "./cnb-whatsapp-template-node";

export {
  CNB_WHATSAPP_ACCESS_TOKEN,
  CNB_WHATSAPP_PHONE_NUMBER_ID,
  CnbWhatsAppTemplateNode,
} from "./cnb-whatsapp-template-node";

/** Clínica No Bairro nodes, registered by `apps/api/src/plugins.ts`. */
export const cnbPlugin: NodePlugin = {
  id: "cnb",
  nodes: [CnbWhatsAppTemplateNode],
};
