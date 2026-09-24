import { ExecutableNode, type NodeContext } from "@dafthunk/runtime";
import type { NodeExecution, NodeType } from "@dafthunk/types";

/** Canonical WhatsApp event, design D18 of the CNB `add-whatsapp-normalizacao`. */
export type Provedor = "meta" | "waha";
export type CodigoFalha =
  | "sem_whatsapp"
  | "fora_da_janela"
  | "limite_do_provedor"
  | "sessao_caida"
  | "temporario"
  | "desconhecido";
export type EventoWhatsApp =
  | {
      tipo: "status";
      provedor: Provedor;
      eventoId: string;
      numeroNosso: string;
      mensagemId: string;
      estado: EstadoStatus;
      falha?: { codigo: CodigoFalha; codigoProvedor: string };
      em: string;
    }
  | {
      tipo: "mensagem";
      provedor: Provedor;
      eventoId: string;
      numeroNosso: string;
      mensagemId: string;
      telefone: string | null;
      contatoOpaco: string | null;
      texto: string;
      em: string;
    }
  | {
      tipo: "sessao";
      provedor: Provedor;
      eventoId: string;
      numeroNosso: string;
      estado: EstadoSessao;
    };
type EstadoStatus = "enviado" | "entregue" | "lido" | "falhou";
type EstadoSessao = "ativa" | "caida";

const TIPOS: Record<EventoWhatsApp["tipo"], true> = {
  status: true,
  mensagem: true,
  sessao: true,
};
const PROVEDORES: Record<Provedor, true> = { meta: true, waha: true };
const ESTADOS_STATUS: Record<EstadoStatus, true> = {
  enviado: true,
  entregue: true,
  lido: true,
  falhou: true,
};
const ESTADOS_SESSAO: Record<EstadoSessao, true> = { ativa: true, caida: true };
const CODIGOS_FALHA: Record<CodigoFalha, true> = {
  sem_whatsapp: true,
  fora_da_janela: true,
  limite_do_provedor: true,
  sessao_caida: true,
  temporario: true,
  desconhecido: true,
};

const ISO_8601 =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function umDe<T extends string>(
  tabela: Record<T, true>,
  valor: unknown
): valor is T {
  return typeof valor === "string" && Object.hasOwn(tabela, valor);
}

function textoNaoVazio(valor: unknown): valor is string {
  return typeof valor === "string" && valor.length > 0;
}

/**
 * Checks one posted value against D18 and rebuilds it with only the canonical
 * fields, or returns the error naming the first bad field. Errors name fields
 * and allowed values only: a value may be the patient's phone.
 */
export function validarEventoWhatsApp(valor: unknown): EventoWhatsApp | string {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) {
    return "evento must be a JSON object";
  }
  const campos = valor as { [campo: string]: unknown };
  const { tipo, provedor, eventoId, numeroNosso } = campos;

  if (!umDe(TIPOS, tipo)) {
    return "evento.tipo must be status, mensagem or sessao";
  }
  if (!umDe(PROVEDORES, provedor)) {
    return "evento.provedor must be meta or waha";
  }
  if (!textoNaoVazio(eventoId)) {
    return "evento.eventoId must be a non-empty string";
  }
  if (!textoNaoVazio(numeroNosso)) {
    return "evento.numeroNosso must be a non-empty string";
  }
  const base = { provedor, eventoId, numeroNosso };

  if (tipo === "sessao") {
    if (!umDe(ESTADOS_SESSAO, campos.estado)) {
      return "evento.estado must be ativa or caida for a sessao";
    }
    return { tipo, ...base, estado: campos.estado };
  }

  const { mensagemId, em } = campos;
  if (!textoNaoVazio(mensagemId)) {
    return "evento.mensagemId must be a non-empty string";
  }
  if (
    typeof em !== "string" ||
    !ISO_8601.test(em) ||
    Number.isNaN(Date.parse(em))
  ) {
    return "evento.em must be an ISO 8601 date-time";
  }

  if (tipo === "status") {
    const { estado, falha } = campos;
    if (!umDe(ESTADOS_STATUS, estado)) {
      return "evento.estado must be enviado, entregue, lido or falhou for a status";
    }
    if (falha === undefined) {
      return { tipo, ...base, mensagemId, estado, em };
    }
    if (typeof falha !== "object" || falha === null || Array.isArray(falha)) {
      return "evento.falha must be an object with codigo and codigoProvedor";
    }
    const { codigo, codigoProvedor } = falha as { [campo: string]: unknown };
    if (!umDe(CODIGOS_FALHA, codigo)) {
      return `evento.falha.codigo must be one of ${Object.keys(CODIGOS_FALHA).join(", ")}`;
    }
    if (typeof codigoProvedor !== "string") {
      return "evento.falha.codigoProvedor must be a string";
    }
    return {
      tipo,
      ...base,
      mensagemId,
      estado,
      falha: { codigo, codigoProvedor },
      em,
    };
  }

  const { telefone, contatoOpaco, texto } = campos;
  if (
    telefone !== null &&
    (typeof telefone !== "string" || !/^\d+$/.test(telefone))
  ) {
    return "evento.telefone must be digits only (55 + DDD + number) or null";
  }
  if (contatoOpaco !== null && !textoNaoVazio(contatoOpaco)) {
    return "evento.contatoOpaco must be a non-empty string or null";
  }
  if (telefone === null && contatoOpaco === null) {
    return "evento.contatoOpaco must be set when evento.telefone is null";
  }
  if (typeof texto !== "string") {
    return "evento.texto must be a string";
  }
  return {
    tipo,
    ...base,
    mensagemId,
    telefone,
    contatoOpaco,
    texto,
    em,
  };
}

/**
 * Entry point of the "CNB entrada de paciente" flow: validates the canonical
 * event the CNB posts and exposes its fields to the rest of the flow.
 */
export class CnbEventoWhatsAppNode extends ExecutableNode {
  public static readonly nodeType: NodeType = {
    id: "cnb-evento-whatsapp",
    name: "CNB Evento WhatsApp",
    type: "cnb-evento-whatsapp",
    description:
      "Validate one canonical CNB WhatsApp event and expose its fields",
    tags: ["Social", "WhatsApp", "Receive"],
    icon: "message-circle",
    documentation:
      "Validates the canonical EventoWhatsApp the Clínica No Bairro posts (a status, mensagem or sessao from Meta or WAHA) and exposes its fields. " +
      "A malformed event fails the node with the offending field in the message; field values are never echoed, since one may be a phone number. " +
      "Fields a tipo does not carry are left unset: a sessao has no mensagemId, and only a mensagem has telefone, contatoOpaco and texto.",
    usage: 1,
    inlinable: false,
    asTool: false,
    inputs: [
      {
        name: "evento",
        type: "json",
        description: "The canonical EventoWhatsApp posted by the CNB",
        required: true,
      },
    ],
    outputs: [
      {
        name: "evento",
        type: "json",
        description: "The validated event, with only its canonical fields",
      },
      {
        name: "tipo",
        type: "string",
        description: "status, mensagem or sessao",
      },
      {
        name: "provedor",
        type: "string",
        description: "meta or waha",
      },
      {
        name: "eventoId",
        type: "string",
        description: "Provider event id, the CNB dedupe key",
      },
      {
        name: "telefone",
        type: "string",
        description:
          "Patient phone in digits, or null when only an opaque contact is known (mensagem)",
      },
      {
        name: "contatoOpaco",
        type: "string",
        description: "Opaque contact such as a WAHA @lid, or null (mensagem)",
      },
      {
        name: "texto",
        type: "string",
        description: "Message text (mensagem)",
      },
      {
        name: "estado",
        type: "string",
        description:
          "enviado, entregue, lido or falhou (status); ativa or caida (sessao)",
      },
      {
        name: "mensagemId",
        type: "string",
        description: "Provider message id (status and mensagem)",
      },
    ],
  };

  public async execute(context: NodeContext): Promise<NodeExecution> {
    const evento = validarEventoWhatsApp(context.inputs.evento);
    if (typeof evento === "string") {
      return this.createErrorResult(evento);
    }
    const comuns = {
      evento,
      tipo: evento.tipo,
      provedor: evento.provedor,
      eventoId: evento.eventoId,
    };
    switch (evento.tipo) {
      case "sessao":
        return this.createSuccessResult({ ...comuns, estado: evento.estado });
      case "status":
        return this.createSuccessResult({
          ...comuns,
          mensagemId: evento.mensagemId,
          estado: evento.estado,
        });
      case "mensagem":
        return this.createSuccessResult({
          ...comuns,
          mensagemId: evento.mensagemId,
          telefone: evento.telefone,
          contatoOpaco: evento.contatoOpaco,
          texto: evento.texto,
        });
    }
  }
}
