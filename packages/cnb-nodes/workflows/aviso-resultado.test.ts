/**
 * `aviso-resultado.json` is the body to POST to `/workflows` when creating the
 * CNB workflow. These tests hold it to what the CNB dispatcher relies on: the
 * API accepts it, and running it on the synchronous runtime with the
 * dispatcher's JSON body sends the template and reports the wamid as
 * `messageId`, or fails with Meta's error code.
 */

import {
  BaseNodeRegistry,
  validateWorkflow,
  WorkerRuntime,
} from "@dafthunk/runtime";
import { HttpRequestNode } from "@dafthunk/runtime/nodes/http/http-request-node";
import { HttpResponseNode } from "@dafthunk/runtime/nodes/http/http-response-node";
import { JsonBodyNode } from "@dafthunk/runtime/nodes/http/json-body-node";
import { JsonExtractObjectNode } from "@dafthunk/runtime/nodes/json/json-extract-object-node";
import { JsonExtractStringNode } from "@dafthunk/runtime/nodes/json/json-extract-string-node";
import type { CreateWorkflowRequest } from "@dafthunk/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildTestDependencies,
  InMemoryObjectStore,
} from "../../runtime/src/__test-stubs__/runtime-harness";
import {
  CNB_WHATSAPP_ACCESS_TOKEN,
  CNB_WHATSAPP_PHONE_NUMBER_ID,
  cnbPlugin,
} from "../src/index";
import avisoResultado from "./aviso-resultado.json";

const workflow = avisoResultado as unknown as CreateWorkflowRequest;

const env = {
  [CNB_WHATSAPP_ACCESS_TOKEN]: "test-token",
  [CNB_WHATSAPP_PHONE_NUMBER_ID]: "123456789012345",
};

class AvisoRegistry extends BaseNodeRegistry {
  protected registerNodes(): void {
    this.registerImplementation(HttpRequestNode);
    this.registerImplementation(JsonBodyNode);
    this.registerImplementation(JsonExtractStringNode);
    this.registerImplementation(JsonExtractObjectNode);
    this.registerImplementation(HttpResponseNode);
    this.registerPlugin(cnbPlugin);
  }
}

/** What the CNB dispatcher POSTs to `/http/<workflowId>`. */
function dispatch(body: Record<string, unknown>) {
  const runtime = new WorkerRuntime(
    env,
    buildTestDependencies({
      nodeRegistry: new AvisoRegistry(env, false),
      objectStore: new InMemoryObjectStore(),
    })
  );
  return runtime.execute({
    workflow: { id: "wf-aviso", ...workflow },
    userId: "api_key",
    organizationId: "org",
    computeCredits: 1000,
    httpRequest: {
      method: "POST",
      url: "https://workflows-api.clinicanobairro.com.br/http/wf-aviso",
      headers: { "content-type": "application/json" },
      query: {},
      body: {
        data: new TextEncoder().encode(JSON.stringify(body)),
        mimeType: "application/json",
      },
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("aviso-resultado workflow", () => {
  it("is accepted by the API's workflow validation", () => {
    const nodeTypes = new AvisoRegistry(env, false).getNodeTypes();

    expect(workflow.trigger).toBe("http_request");
    expect(workflow.runtime).toBe("worker");
    expect(validateWorkflow({ id: "wf", ...workflow }, nodeTypes)).toEqual([]);
  });

  it("sends the dispatcher's message and reports the wamid as messageId", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ messages: [{ id: "wamid.OK" }] }))
    );
    vi.stubGlobal("fetch", fetchMock);

    const execution = await dispatch({
      execucao_id: "exec-1",
      template: "aviso_resultado",
      telefone: "5593991234567",
      variaveis: { primeiro_nome: "Maria", unidade: "Centro" },
    });

    expect(execution.status).toBe("completed");
    expect(
      execution.nodeExecutions.map((n) => n.outputs?.messageId).filter(Boolean)
    ).toContain("wamid.OK");
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(sent.to).toBe("5593991234567");
    expect(sent.template.name).toBe("aviso_resultado");
    expect(sent.template.language).toEqual({ code: "pt_BR" });
    expect(sent.template.components[0].parameters).toEqual([
      { type: "text", text: "Maria" },
      { type: "text", text: "Centro" },
    ]);
  });

  it("falls back to the aviso_resultado template when the body names none", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ messages: [{ id: "wamid.OK" }] }))
    );
    vi.stubGlobal("fetch", fetchMock);

    const execution = await dispatch({
      telefone: "5593991234567",
      variaveis: { primeiro_nome: "Maria", unidade: "Centro" },
    });

    expect(execution.status).toBe("completed");
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(sent.template.name).toBe("aviso_resultado");
  });

  it("ends in error, with Meta's code on the failed node, when Graph rejects the send", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { code: 131026, message: "Message undeliverable." },
            }),
            { status: 400 }
          )
      )
    );

    const execution = await dispatch({
      telefone: "5593991234567",
      variaveis: { primeiro_nome: "Maria", unidade: "Centro" },
    });

    expect(execution.status).toBe("error");
    const failed = execution.nodeExecutions.find((n) => n.status === "error");
    expect(failed?.error).toContain("code 131026");
  });
});
