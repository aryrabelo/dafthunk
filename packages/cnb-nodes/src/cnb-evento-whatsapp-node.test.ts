/**
 * The CNB posts one canonical `EventoWhatsApp` (design D18) to the
 * "entrada de paciente" flow. The node is the flow's contract check: a valid
 * event comes out as named outputs, anything else fails naming the field and
 * never echoing the patient's phone.
 */

import type { NodeContext } from "@dafthunk/runtime";
import type { Node } from "@dafthunk/types";
import { describe, expect, it } from "vitest";

import { CnbEventoWhatsAppNode } from "./cnb-evento-whatsapp-node";

const node = new CnbEventoWhatsAppNode({
  id: "evento",
  name: "Evento",
  type: "cnb-evento-whatsapp",
  position: { x: 0, y: 0 },
  inputs: [],
  outputs: [],
} as Node);

function run(evento: unknown) {
  return node.execute({
    nodeId: "evento",
    workflowId: "wf",
    organizationId: "org",
    inputs: { evento },
    getIntegration: async () => {
      throw new Error("no integrations");
    },
    env: {},
  } as unknown as NodeContext);
}

const TELEFONE = "5593999990001";

const mensagem = {
  tipo: "mensagem",
  provedor: "waha",
  eventoId: "evt_msg_1",
  numeroNosso: "cnb-aviso-teste",
  mensagemId: "false_5593999990001@c.us_3EB0AAAA",
  telefone: TELEFONE,
  contatoOpaco: null,
  texto: "que horas abre?",
  em: "2026-09-24T12:00:00.000Z",
};

const status = {
  tipo: "status",
  provedor: "meta",
  eventoId: "wamid.X:entregue",
  numeroNosso: "123456789012345",
  mensagemId: "wamid.X",
  estado: "entregue",
  em: "2026-09-24T12:00:05Z",
};

const sessao = {
  tipo: "sessao",
  provedor: "waha",
  eventoId: "evt_sessao_1",
  numeroNosso: "cnb-aviso-teste",
  estado: "caida",
};

describe("CnbEventoWhatsAppNode", () => {
  it("exposes a mensagem's fields as outputs", async () => {
    const result = await run(mensagem);

    expect(result.status).toBe("completed");
    expect(result.outputs).toMatchObject({
      tipo: "mensagem",
      provedor: "waha",
      eventoId: "evt_msg_1",
      mensagemId: "false_5593999990001@c.us_3EB0AAAA",
      telefone: TELEFONE,
      contatoOpaco: null,
      texto: "que horas abre?",
    });
    expect(result.outputs?.evento).toEqual(mensagem);
  });

  it("accepts a mensagem from an unresolved @lid: telefone null, contatoOpaco set", async () => {
    const result = await run({
      ...mensagem,
      telefone: null,
      contatoOpaco: "123456789012345@lid",
    });

    expect(result.status).toBe("completed");
    expect(result.outputs).toMatchObject({
      telefone: null,
      contatoOpaco: "123456789012345@lid",
    });
  });

  it("exposes a status's fields as outputs", async () => {
    const result = await run(status);

    expect(result.status).toBe("completed");
    expect(result.outputs).toMatchObject({
      tipo: "status",
      provedor: "meta",
      eventoId: "wamid.X:entregue",
      mensagemId: "wamid.X",
      estado: "entregue",
    });
  });

  it("accepts a failed status carrying the classified failure", async () => {
    const result = await run({
      ...status,
      eventoId: "wamid.X:falhou",
      estado: "falhou",
      falha: { codigo: "sem_whatsapp", codigoProvedor: "131026" },
    });

    expect(result.status).toBe("completed");
    expect(result.outputs).toMatchObject({ estado: "falhou" });
  });

  it("exposes a sessao's fields as outputs", async () => {
    const result = await run(sessao);

    expect(result.status).toBe("completed");
    expect(result.outputs).toMatchObject({
      tipo: "sessao",
      provedor: "waha",
      eventoId: "evt_sessao_1",
      estado: "caida",
    });
  });

  it.each([
    ["eventoId", "missing", { ...mensagem, eventoId: undefined }],
    ["eventoId", "empty", { ...status, eventoId: "" }],
    ["tipo", "unknown", { ...mensagem, tipo: "reacao" }],
    ["provedor", "unknown", { ...status, provedor: "twilio" }],
    ["estado", "not a status estado", { ...status, estado: "ativa" }],
    ["estado", "not a sessao estado", { ...sessao, estado: "lido" }],
    [
      "telefone",
      "not digits",
      { ...mensagem, telefone: "+55 (93) 99999-0001" },
    ],
    ["telefone", "missing", { ...mensagem, telefone: undefined }],
    [
      "contatoOpaco",
      "null alongside a null telefone",
      { ...mensagem, telefone: null, contatoOpaco: null },
    ],
    ["mensagemId", "missing on a status", { ...status, mensagemId: undefined }],
    ["texto", "not a string", { ...mensagem, texto: 42 }],
    ["em", "not an ISO date", { ...mensagem, em: "ontem" }],
    ["numeroNosso", "missing", { ...sessao, numeroNosso: undefined }],
    [
      "falha.codigo",
      "unknown",
      {
        ...status,
        estado: "falhou",
        falha: { codigo: "banido", codigoProvedor: "131026" },
      },
    ],
  ])("fails naming %s when it is %s", async (campo, _caso, evento) => {
    const result = await run(evento);

    expect(result.status).toBe("error");
    expect(result.error).toContain(`evento.${campo} `);
  });

  it.each([
    ["an array", [mensagem]],
    ["a string", JSON.stringify(mensagem)],
    ["missing", undefined],
  ])("fails when the evento is %s", async (_caso, evento) => {
    const result = await run(evento);

    expect(result.status).toBe("error");
    expect(result.error).toContain("evento");
  });

  it("never echoes the phone in an error", async () => {
    const telefoneRuim = "55 93 99999 0001";
    const result = await run({ ...mensagem, telefone: telefoneRuim, em: "x" });

    expect(result.status).toBe("error");
    expect(result.error).not.toContain(telefoneRuim);
    expect(result.error).not.toContain("99999");
  });
});
