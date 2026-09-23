import {
  ExecutableNode,
  type NodeContext,
  type NodeEnv,
} from "@dafthunk/runtime";
import type { NodeExecution, NodeType } from "@dafthunk/types";

/**
 * Worker secrets holding the clinic's WhatsApp Business credentials. Set with
 * `wrangler secret put <name> --env production`. Every runtime hands the
 * Worker's bindings to nodes as `context.env`, including the synchronous
 * `/http/:workflowId` path, so no org secret or trigger wiring is involved.
 */
export const CNB_WHATSAPP_ACCESS_TOKEN = "CNB_WHATSAPP_ACCESS_TOKEN";
export const CNB_WHATSAPP_PHONE_NUMBER_ID = "CNB_WHATSAPP_PHONE_NUMBER_ID";

type CnbWhatsAppEnv = NodeEnv & {
  [CNB_WHATSAPP_ACCESS_TOKEN]?: string;
  [CNB_WHATSAPP_PHONE_NUMBER_ID]?: string;
};

interface GraphErrorBody {
  error?: { code?: number; message?: string };
}

interface GraphSendBody {
  messages?: { id?: string }[];
}

/**
 * Sends a pre-approved WhatsApp template through the Graph API with the
 * clinic's own credentials, so any trigger (notably `/http`) can send it.
 * The built-in template node only works under the WhatsApp webhook, which is
 * the one trigger that supplies credentials.
 */
export class CnbWhatsAppTemplateNode extends ExecutableNode {
  public static readonly nodeType: NodeType = {
    id: "cnb-whatsapp-template",
    name: "CNB WhatsApp Template",
    type: "cnb-whatsapp-template",
    description:
      "Send a WhatsApp template with the Clínica No Bairro Business account",
    tags: ["Social", "WhatsApp", "Template", "Send"],
    icon: "file-text",
    documentation:
      `Sends an approved template through the WhatsApp Business Cloud API using the Worker secrets ${CNB_WHATSAPP_ACCESS_TOKEN} and ${CNB_WHATSAPP_PHONE_NUMBER_ID}. ` +
      "`variaveis.primeiro_nome` and `variaveis.unidade` fill the body parameters {{1}} and {{2}}. " +
      "On a Graph API error the node fails with Meta's error code in the message.",
    usage: 10,
    inlinable: false,
    asTool: false,
    inputs: [
      {
        name: "telefone",
        type: "string",
        description: "Recipient phone number: digits only, with country code",
        required: true,
      },
      {
        name: "template",
        type: "string",
        description: "Name of the approved message template",
        value: "aviso_resultado",
      },
      {
        name: "idioma",
        type: "string",
        description: "Template language code",
        value: "pt_BR",
      },
      {
        name: "variaveis",
        type: "json",
        description:
          "Body parameters: { primeiro_nome, unidade }, sent as {{1}} and {{2}}",
        required: true,
      },
    ],
    outputs: [
      {
        name: "messageId",
        type: "string",
        description: "WhatsApp message id (wamid) returned by Meta",
      },
    ],
  };

  public async execute(context: NodeContext): Promise<NodeExecution> {
    const env = context.env as CnbWhatsAppEnv;
    const accessToken = env[CNB_WHATSAPP_ACCESS_TOKEN];
    const phoneNumberId = env[CNB_WHATSAPP_PHONE_NUMBER_ID];
    if (!accessToken) {
      return this.createErrorResult(
        `Worker secret ${CNB_WHATSAPP_ACCESS_TOKEN} is not set`
      );
    }
    if (!phoneNumberId) {
      return this.createErrorResult(
        `Worker secret ${CNB_WHATSAPP_PHONE_NUMBER_ID} is not set`
      );
    }

    const { telefone, template, idioma, variaveis } = context.inputs;
    if (typeof telefone !== "string" || !/^\d+$/.test(telefone)) {
      return this.createErrorResult(
        "telefone must be digits only, with country code"
      );
    }
    const primeiroNome = variaveis?.primeiro_nome;
    const unidade = variaveis?.unidade;
    if (
      typeof primeiroNome !== "string" ||
      !primeiroNome ||
      typeof unidade !== "string" ||
      !unidade
    ) {
      return this.createErrorResult(
        "variaveis must be an object with non-empty primeiro_nome and unidade"
      );
    }

    // Anything we echo from the network is scrubbed of the token first: the
    // error text is persisted with the execution and returned to the caller.
    const redact = (text: string) => text.replaceAll(accessToken, "[redacted]");

    let response: Response;
    try {
      response = await fetch(
        `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: telefone,
            type: "template",
            template: {
              name:
                typeof template === "string" && template
                  ? template
                  : "aviso_resultado",
              language: {
                code: typeof idioma === "string" && idioma ? idioma : "pt_BR",
              },
              components: [
                {
                  type: "body",
                  parameters: [
                    { type: "text", text: primeiroNome },
                    { type: "text", text: unidade },
                  ],
                },
              ],
            },
          }),
        }
      );
    } catch (error) {
      return this.createErrorResult(
        redact(
          `WhatsApp Graph API request failed: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }

    const text = await response.text();
    if (!response.ok) {
      let graphError: GraphErrorBody["error"];
      try {
        graphError = (JSON.parse(text) as GraphErrorBody).error;
      } catch {
        graphError = undefined;
      }
      const detail =
        graphError?.code !== undefined
          ? `code ${graphError.code}: ${graphError.message ?? ""}`
          : text.slice(0, 500);
      return this.createErrorResult(
        redact(
          `WhatsApp Graph API error (HTTP ${response.status}) ${detail}`.trim()
        )
      );
    }

    let messageId: string | undefined;
    try {
      messageId = (JSON.parse(text) as GraphSendBody).messages?.[0]?.id;
    } catch {
      messageId = undefined;
    }
    if (!messageId) {
      return this.createErrorResult(
        `WhatsApp Graph API replied HTTP ${response.status} with no message id`
      );
    }
    return this.createSuccessResult({ messageId });
  }
}
