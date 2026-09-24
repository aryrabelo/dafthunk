import type { NodePlugin } from "@dafthunk/runtime";

import { CnbEventoWhatsAppNode } from "./cnb-evento-whatsapp-node";
import { CnbWhatsAppTemplateNode } from "./cnb-whatsapp-template-node";

export {
  CnbEventoWhatsAppNode,
  type CodigoFalha,
  type EventoWhatsApp,
  type Provedor,
  validarEventoWhatsApp,
} from "./cnb-evento-whatsapp-node";
export {
  CNB_WAHA_API_KEY,
  CNB_WAHA_SESSION,
  CNB_WHATSAPP_ACCESS_TOKEN,
  CNB_WHATSAPP_BASE_URL,
  CNB_WHATSAPP_DESTINOS_PERMITIDOS,
  CNB_WHATSAPP_PHONE_NUMBER_ID,
  CNB_WHATSAPP_PROVIDER,
  CnbWhatsAppTemplateNode,
} from "./cnb-whatsapp-template-node";

/** Clínica No Bairro nodes, registered by `apps/api/src/plugins.ts`. */
export const cnbPlugin: NodePlugin = {
  id: "cnb",
  nodes: [CnbWhatsAppTemplateNode, CnbEventoWhatsAppNode],
};
