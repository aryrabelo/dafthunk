import {
  ExecutableNode,
  type NodeContext,
  type NodeEnv,
} from "@dafthunk/runtime";
import type { NodeExecution, NodeType } from "@dafthunk/types";

/**
 * Worker bindings read by the node. Secrets are set with
 * `wrangler secret put <name> --env production`; the rest can be plain vars.
 * Every runtime hands the Worker's bindings to nodes as `context.env`,
 * including the synchronous `/http/:workflowId` path, so no org secret or
 * trigger wiring is involved.
 */
/** `meta` (default) or `waha`. */
export const CNB_WHATSAPP_PROVIDER = "CNB_WHATSAPP_PROVIDER";
/** Provider base URL. Defaults to the Graph API for `meta`; required for `waha`. */
export const CNB_WHATSAPP_BASE_URL = "CNB_WHATSAPP_BASE_URL";
/** Meta: WhatsApp Business Cloud API credentials. */
export const CNB_WHATSAPP_ACCESS_TOKEN = "CNB_WHATSAPP_ACCESS_TOKEN";
export const CNB_WHATSAPP_PHONE_NUMBER_ID = "CNB_WHATSAPP_PHONE_NUMBER_ID";
/** WAHA: API key (sent as `X-Api-Key`) and the session that sends. */
export const CNB_WAHA_API_KEY = "CNB_WAHA_API_KEY";
export const CNB_WAHA_SESSION = "CNB_WAHA_SESSION";
/** WAHA: comma-separated phones allowed to receive; anyone else is refused. */
export const CNB_WHATSAPP_DESTINOS_PERMITIDOS =
  "CNB_WHATSAPP_DESTINOS_PERMITIDOS";

type CnbWhatsAppEnv = NodeEnv & {
  [CNB_WHATSAPP_PROVIDER]?: string;
  [CNB_WHATSAPP_BASE_URL]?: string;
  [CNB_WHATSAPP_ACCESS_TOKEN]?: string;
  [CNB_WHATSAPP_PHONE_NUMBER_ID]?: string;
  [CNB_WAHA_API_KEY]?: string;
  [CNB_WAHA_SESSION]?: string;
  [CNB_WHATSAPP_DESTINOS_PERMITIDOS]?: string;
};

const TEMPLATE_PADRAO = "aviso_resultado";
const IDIOMA_PADRAO = "pt_BR";
const META_BASE_URL_PADRAO = "https://graph.facebook.com";

/** Graph API `/messages` reply; every field is checked before use. */
interface GraphReply {
  error?: { code?: unknown; message?: unknown };
  messages?: { id?: unknown }[];
}

/** WAHA reply: a `WAMessage` on success, NestJS-style error otherwise. */
interface WahaReply {
  id?: unknown;
  code?: unknown;
  message?: unknown;
}

type Provedor = "meta" | "waha";

/** One validated aviso, independent of the provider that delivers it. */
interface Aviso {
  telefone: string;
  template: string;
  idioma: string;
  primeiroNome: string;
  unidade: string;
}

/**
 * Outcome of one send. `codigo` is what the CNB classifies on: Meta's error
 * code, WAHA's error code or HTTP status, or a named local refusal.
 */
type ResultadoEnvio =
  | { ok: true; messageId: string }
  | { ok: false; codigo: string; detalhe: string };

/** Port: delivers an aviso through one WhatsApp provider. */
interface EnvioWhatsApp {
  readonly provedor: Provedor;
  /** Values that must never appear in an error. */
  readonly segredos: readonly string[];
  enviar(aviso: Aviso): Promise<ResultadoEnvio>;
}

/** POSTs JSON; a thrown fetch comes back as `falha` instead of rejecting. */
async function postar<Reply>(
  url: string,
  headers: Record<string, string>,
  body: unknown
): Promise<
  | { response: Response; text: string; reply: Reply | undefined }
  | { falha: string }
> {
  let response: Response;
  let text: string;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    text = await response.text();
  } catch (error) {
    return { falha: error instanceof Error ? error.message : String(error) };
  }
  let reply: Reply | undefined;
  try {
    reply = JSON.parse(text) ?? undefined;
  } catch {
    reply = undefined;
  }
  return { response, text, reply };
}

/** Graph API `/messages` with the approved template. */
class EnvioMeta implements EnvioWhatsApp {
  readonly provedor = "meta";
  readonly segredos: readonly string[];

  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
    private readonly phoneNumberId: string
  ) {
    this.segredos = [accessToken];
  }

  async enviar(aviso: Aviso): Promise<ResultadoEnvio> {
    const sent = await postar<GraphReply>(
      `${this.baseUrl}/v21.0/${this.phoneNumberId}/messages`,
      { Authorization: `Bearer ${this.accessToken}` },
      {
        messaging_product: "whatsapp",
        to: aviso.telefone,
        type: "template",
        template: {
          name: aviso.template,
          language: { code: aviso.idioma },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: aviso.primeiroNome },
                { type: "text", text: aviso.unidade },
              ],
            },
          ],
        },
      }
    );
    if ("falha" in sent) {
      return {
        ok: false,
        codigo: "falha_de_rede",
        detalhe: `request failed: ${sent.falha}`,
      };
    }

    const { response, text, reply } = sent;
    if (!response.ok) {
      const code = reply?.error?.code;
      if (typeof code === "number" || (typeof code === "string" && code)) {
        const message = reply?.error?.message;
        return {
          ok: false,
          codigo: String(code),
          detalhe:
            `(HTTP ${response.status}) ${typeof message === "string" ? message : ""}`.trim(),
        };
      }
      return {
        ok: false,
        codigo: String(response.status),
        detalhe: `(HTTP ${response.status}) ${text.slice(0, 500)}`.trim(),
      };
    }

    const id = Array.isArray(reply?.messages)
      ? reply.messages[0]?.id
      : undefined;
    if (typeof id !== "string" || !id) {
      return {
        ok: false,
        codigo: "sem_message_id",
        detalhe: `(HTTP ${response.status}) replied with no message id`,
      };
    }
    return { ok: true, messageId: id };
  }
}

/**
 * WAHA `sendText` with the D7 text rendered, for validation with a test
 * session only. WAHA has no templates, so only `aviso_resultado` exists, and
 * only destinations on the allow-list may receive it.
 */
class EnvioWaha implements EnvioWhatsApp {
  readonly provedor = "waha";
  readonly segredos: readonly string[];

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly session: string,
    private readonly destinosPermitidos: ReadonlySet<string>
  ) {
    this.segredos = [apiKey];
  }

  async enviar(aviso: Aviso): Promise<ResultadoEnvio> {
    if (!this.destinosPermitidos.has(aviso.telefone)) {
      return {
        ok: false,
        codigo: "destino_nao_permitido",
        detalhe: `destination is not in ${CNB_WHATSAPP_DESTINOS_PERMITIDOS}`,
      };
    }
    if (aviso.template !== TEMPLATE_PADRAO) {
      return {
        ok: false,
        codigo: "template_desconhecido",
        detalhe: `only ${TEMPLATE_PADRAO} has a WAHA text, got ${aviso.template}`,
      };
    }

    const sent = await postar<WahaReply>(
      `${this.baseUrl}/api/sendText`,
      { "X-Api-Key": this.apiKey },
      {
        session: this.session,
        chatId: `${aviso.telefone}@c.us`,
        text: textoAvisoResultado(aviso),
      }
    );
    if ("falha" in sent) {
      return {
        ok: false,
        codigo: "falha_de_rede",
        detalhe: `request failed: ${sent.falha}`,
      };
    }

    const { response, text, reply } = sent;
    if (!response.ok) {
      const code = reply?.code;
      const message = reply?.message;
      const detalhe =
        typeof message === "string"
          ? message
          : Array.isArray(message)
            ? message.join("; ")
            : text.slice(0, 500);
      return {
        ok: false,
        codigo:
          typeof code === "number" || (typeof code === "string" && code)
            ? String(code)
            : String(response.status),
        detalhe: `(HTTP ${response.status}) ${detalhe}`.trim(),
      };
    }

    // The OpenAPI types `id` as a string; engines like WEBJS return the
    // message key object instead, whose `_serialized` is that string.
    const id = reply?.id;
    const messageId =
      typeof id === "string"
        ? id
        : typeof id === "object" &&
            id !== null &&
            "_serialized" in id &&
            typeof id._serialized === "string"
          ? id._serialized
          : "";
    if (!messageId) {
      return {
        ok: false,
        codigo: "sem_message_id",
        detalhe: `(HTTP ${response.status}) replied with no message id`,
      };
    }
    return { ok: true, messageId };
  }
}

/** D7 `aviso_resultado` as plain text, with the portal link and the opt-out line. */
function textoAvisoResultado(aviso: Aviso): string {
  return [
    `Olá, ${aviso.primeiroNome}! Os resultados dos seus exames na Clínica No Bairro estão prontos. ` +
      `Você pode consultá-los pelo portal ou retirar na unidade ${aviso.unidade}.`,
    "https://clinicanobairro.com.br/resultados",
    "Para não receber mais avisos, responda PARAR.",
  ].join("\n\n");
}

/** Builds the configured provider, or the configuration error. */
function configurarEnvio(env: CnbWhatsAppEnv): EnvioWhatsApp | string {
  const provedor = (env[CNB_WHATSAPP_PROVIDER] ?? "").trim() || "meta";
  const baseUrl = (env[CNB_WHATSAPP_BASE_URL] ?? "").trim().replace(/\/+$/, "");

  if (provedor === "meta") {
    const accessToken = env[CNB_WHATSAPP_ACCESS_TOKEN];
    const phoneNumberId = env[CNB_WHATSAPP_PHONE_NUMBER_ID];
    if (!accessToken) {
      return `Worker secret ${CNB_WHATSAPP_ACCESS_TOKEN} is not set`;
    }
    if (!phoneNumberId) {
      return `Worker secret ${CNB_WHATSAPP_PHONE_NUMBER_ID} is not set`;
    }
    return new EnvioMeta(
      baseUrl || META_BASE_URL_PADRAO,
      accessToken,
      phoneNumberId
    );
  }

  if (provedor === "waha") {
    if (!baseUrl) {
      return `${CNB_WHATSAPP_BASE_URL} is required when ${CNB_WHATSAPP_PROVIDER} is waha`;
    }
    const apiKey = env[CNB_WAHA_API_KEY];
    if (!apiKey) {
      return `Worker secret ${CNB_WAHA_API_KEY} is not set (required for waha)`;
    }
    const session = (env[CNB_WAHA_SESSION] ?? "").trim();
    if (!session) {
      return `${CNB_WAHA_SESSION} is not set (required for waha)`;
    }
    const destinos = new Set(
      (env[CNB_WHATSAPP_DESTINOS_PERMITIDOS] ?? "")
        .split(",")
        .map((telefone) => telefone.replace(/\D/g, ""))
        .filter(Boolean)
    );
    return new EnvioWaha(baseUrl, apiKey, session, destinos);
  }

  return `${CNB_WHATSAPP_PROVIDER} must be meta or waha, got ${provedor}`;
}

/**
 * Sends the result notice with the clinic's own credentials, so any trigger
 * (notably `/http`) can send it. The built-in template node only works under
 * the WhatsApp webhook, which is the one trigger that supplies credentials.
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
      `Sends the notice through the provider in ${CNB_WHATSAPP_PROVIDER}: \`meta\` (default) sends the approved template through the WhatsApp Business Cloud API with ${CNB_WHATSAPP_ACCESS_TOKEN} and ${CNB_WHATSAPP_PHONE_NUMBER_ID}; ` +
      `\`waha\` sends the aviso_resultado text through WAHA sendText with ${CNB_WAHA_API_KEY} and ${CNB_WAHA_SESSION}, only to phones in ${CNB_WHATSAPP_DESTINOS_PERMITIDOS}. ` +
      `${CNB_WHATSAPP_BASE_URL} overrides the provider's base URL (required for waha). ` +
      "`variaveis.primeiro_nome` and `variaveis.unidade` fill {{1}} and {{2}}. " +
      "On failure the node fails with `provider <meta|waha> code <N>` in the message.",
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
        value: TEMPLATE_PADRAO,
      },
      {
        name: "idioma",
        type: "string",
        description: "Template language code",
        value: IDIOMA_PADRAO,
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
        description:
          "Message id returned by the provider (Meta wamid or WAHA id)",
      },
    ],
  };

  public async execute(context: NodeContext): Promise<NodeExecution> {
    const envio = configurarEnvio(context.env as CnbWhatsAppEnv);
    if (typeof envio === "string") {
      return this.createErrorResult(envio);
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

    const resultado = await envio.enviar({
      telefone,
      template:
        typeof template === "string" && template ? template : TEMPLATE_PADRAO,
      idioma: typeof idioma === "string" && idioma ? idioma : IDIOMA_PADRAO,
      primeiroNome,
      unidade,
    });
    if (resultado.ok) {
      return this.createSuccessResult({ messageId: resultado.messageId });
    }

    // Anything we echo from the network is scrubbed of the provider's secret
    // first: the error text is persisted with the execution and returned to
    // the caller.
    let mensagem = `WhatsApp send failed: provider ${envio.provedor} code ${resultado.codigo} ${resultado.detalhe}`;
    for (const segredo of envio.segredos) {
      mensagem = mensagem.replaceAll(segredo, "[redacted]");
    }
    return this.createErrorResult(mensagem);
  }
}
