/**
 * `entrada-paciente.json` is the body to POST to `/workflows` when creating
 * the "CNB entrada de paciente" flow. The CNB posts one canonical
 * `EventoWhatsApp` to `/http/<workflowId>` and expects
 * `{ recebido: true, tipo, eventoId }` back, or a failed execution when the
 * event breaks the contract.
 */

import {
  BaseNodeRegistry,
  validateWorkflow,
  WorkerRuntime,
} from "@dafthunk/runtime";
import { HttpRequestNode } from "@dafthunk/runtime/nodes/http/http-request-node";
import { HttpResponseNode } from "@dafthunk/runtime/nodes/http/http-response-node";
import { JsonBodyNode } from "@dafthunk/runtime/nodes/http/json-body-node";
import { JsonTemplateNode } from "@dafthunk/runtime/nodes/json/json-template-node";
import type { CreateWorkflowRequest } from "@dafthunk/types";
import { describe, expect, it } from "vitest";

import {
  buildTestDependencies,
  InMemoryObjectStore,
} from "../../runtime/src/__test-stubs__/runtime-harness";
import { cnbPlugin } from "../src/index";
import entradaPaciente from "./entrada-paciente.json";

const workflow = entradaPaciente as unknown as CreateWorkflowRequest;

class EntradaRegistry extends BaseNodeRegistry {
  protected registerNodes(): void {
    this.registerImplementation(HttpRequestNode);
    this.registerImplementation(JsonBodyNode);
    this.registerImplementation(JsonTemplateNode);
    this.registerImplementation(HttpResponseNode);
    this.registerPlugin(cnbPlugin);
  }
}

/** Holds the blobs the run writes, so the response body can be read back. */
const objectStore = new InMemoryObjectStore();

/** What the CNB posts to `/http/<workflowId>`. */
function receber(evento: unknown) {
  const runtime = new WorkerRuntime(
    {},
    buildTestDependencies({
      nodeRegistry: new EntradaRegistry({}, false),
      objectStore,
    })
  );
  return runtime.execute({
    workflow: { id: "wf-entrada", ...workflow },
    userId: "api_key",
    organizationId: "org",
    computeCredits: 1000,
    httpRequest: {
      method: "POST",
      url: "https://workflows-api.clinicanobairro.com.br/http/wf-entrada",
      headers: { "content-type": "application/json" },
      query: {},
      body: {
        data: new TextEncoder().encode(JSON.stringify(evento)),
        mimeType: "application/json",
      },
    },
  });
}

const mensagem = {
  tipo: "mensagem",
  provedor: "waha",
  eventoId: "evt_msg_1",
  numeroNosso: "cnb-aviso-teste",
  mensagemId: "false_5593999990001@c.us_3EB0AAAA",
  telefone: "5593999990001",
  contatoOpaco: null,
  texto: "que horas abre?",
  em: "2026-09-24T12:00:00.000Z",
};

describe("entrada-paciente workflow", () => {
  it("wires every edge to an existing node and routes the body through cnb-evento-whatsapp", () => {
    const ids = new Set(workflow.nodes.map((n) => n.id));

    expect(ids.size).toBe(workflow.nodes.length);
    for (const edge of workflow.edges) {
      expect(ids).toContain(edge.source);
      expect(ids).toContain(edge.target);
    }
    const evento = workflow.nodes.filter(
      (n) => n.type === "cnb-evento-whatsapp"
    );
    expect(evento).toHaveLength(1);
    expect(workflow.edges).toContainEqual(
      expect.objectContaining({ target: evento[0].id, targetInput: "evento" })
    );
    const [corpo] = workflow.nodes.filter((n) => n.type === "body-json");
    expect(workflow.edges).toContainEqual(
      expect.objectContaining({ source: corpo.id, target: evento[0].id })
    );
  });

  it("is accepted by the API's workflow validation", () => {
    const nodeTypes = new EntradaRegistry({}, false).getNodeTypes();

    expect(workflow.trigger).toBe("http_request");
    expect(workflow.runtime).toBe("worker");
    expect(validateWorkflow({ id: "wf", ...workflow }, nodeTypes)).toEqual([]);
  });

  it("answers { recebido: true, tipo, eventoId } for a valid event", async () => {
    const execution = await receber(mensagem);

    expect(execution.status).toBe("completed");
    const [response] = workflow.nodes.filter((n) => n.type === "http-response");
    const body = execution.nodeExecutions.find((n) => n.nodeId === response.id)
      ?.outputs?.body;
    expect(body).toMatchObject({ mimeType: "application/json" });
    const id = body && typeof body === "object" && "id" in body ? body.id : "";
    const stored = await objectStore.readObject({
      id: String(id),
      mimeType: "application/json",
    });
    expect(stored).not.toBeNull();
    expect(JSON.parse(new TextDecoder().decode(stored?.data))).toEqual({
      recebido: true,
      tipo: "mensagem",
      eventoId: "evt_msg_1",
    });
  });

  it("ends in error, naming the field, when the event breaks the contract", async () => {
    const execution = await receber({ ...mensagem, tipo: "reacao" });

    expect(execution.status).toBe("error");
    const failed = execution.nodeExecutions.find((n) => n.status === "error");
    expect(failed?.error).toContain("tipo");
  });
});
