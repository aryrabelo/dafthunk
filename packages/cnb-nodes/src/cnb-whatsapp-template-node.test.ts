/**
 * The CNB dispatcher trusts exactly two things from this node: a `messageId`
 * (the wamid) on success, and a failure whose text carries Meta's error code.
 * The access token is a Worker secret and must never surface in either.
 */

import type { NodeContext } from "@dafthunk/runtime";
import type { Node } from "@dafthunk/types";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";

import {
  CNB_WHATSAPP_ACCESS_TOKEN,
  CNB_WHATSAPP_PHONE_NUMBER_ID,
  CnbWhatsAppTemplateNode,
} from "./cnb-whatsapp-template-node";

const TOKEN = "EAAG-secret-token-do-not-leak";
const PHONE_NUMBER_ID = "123456789012345";

const secrets = {
  [CNB_WHATSAPP_ACCESS_TOKEN]: TOKEN,
  [CNB_WHATSAPP_PHONE_NUMBER_ID]: PHONE_NUMBER_ID,
};

const node = new CnbWhatsAppTemplateNode({
  id: "enviar",
  name: "Enviar",
  type: "cnb-whatsapp-template",
  position: { x: 0, y: 0 },
  inputs: [],
  outputs: [],
} as Node);

function run(
  inputs: Record<string, unknown>,
  env: Record<string, string> = secrets
) {
  return node.execute({
    nodeId: "enviar",
    workflowId: "wf",
    organizationId: "org",
    inputs,
    getIntegration: async () => {
      throw new Error("no integrations");
    },
    env,
  } as unknown as NodeContext);
}

const avisoInputs = {
  telefone: "5593991234567",
  variaveis: { primeiro_nome: "Maria", unidade: "Centro" },
};

type GraphFetch = Mock<(url: string, init: RequestInit) => Promise<Response>>;

function graphReplies(status: number, body: unknown): GraphFetch {
  const fetchMock: GraphFetch = vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentRequest(fetchMock: GraphFetch) {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0];
  return {
    url,
    method: init.method,
    headers: new Headers(init.headers),
    body: JSON.parse(String(init.body)),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CnbWhatsAppTemplateNode", () => {
  it("sends the template to the Graph API and returns the wamid as messageId", async () => {
    const fetchMock = graphReplies(200, {
      messaging_product: "whatsapp",
      contacts: [{ input: "5593991234567", wa_id: "5593991234567" }],
      messages: [{ id: "wamid.HBgMNTU5Mzk5MTIzNDU2NxUCABEYEjQ" }],
    });

    const result = await run(avisoInputs);

    expect(result.status).toBe("completed");
    expect(result.outputs).toEqual({
      messageId: "wamid.HBgMNTU5Mzk5MTIzNDU2NxUCABEYEjQ",
    });

    const request = sentRequest(fetchMock);
    expect(request.url).toBe(
      `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`
    );
    expect(request.method).toBe("POST");
    expect(request.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(request.body).toEqual({
      messaging_product: "whatsapp",
      to: "5593991234567",
      type: "template",
      template: {
        name: "aviso_resultado",
        language: { code: "pt_BR" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "Maria" },
              { type: "text", text: "Centro" },
            ],
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("uses the template and language it is given over the defaults", async () => {
    const fetchMock = graphReplies(200, { messages: [{ id: "wamid.X" }] });

    await run({ ...avisoInputs, template: "lembrete", idioma: "en_US" });

    const { template } = sentRequest(fetchMock).body;
    expect(template.name).toBe("lembrete");
    expect(template.language).toEqual({ code: "en_US" });
  });

  it("falls back to aviso_resultado / pt_BR when the extraction yields empty strings", async () => {
    const fetchMock = graphReplies(200, { messages: [{ id: "wamid.X" }] });

    await run({ ...avisoInputs, template: "", idioma: "" });

    const { template } = sentRequest(fetchMock).body;
    expect(template.name).toBe("aviso_resultado");
    expect(template.language).toEqual({ code: "pt_BR" });
  });

  it("fails with Meta's error code when the Graph API rejects the send, without leaking the token", async () => {
    graphReplies(400, {
      error: {
        message: `(#131026) Message undeliverable. token=${TOKEN}`,
        type: "OAuthException",
        code: 131026,
        fbtrace_id: "AbCdEf",
      },
    });

    const result = await run(avisoInputs);

    expect(result.status).toBe("error");
    expect(result.error).toContain("code 131026");
    expect(result.error).toContain("HTTP 400");
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("fails with the HTTP status when the Graph API error is not JSON", async () => {
    graphReplies(502, "<html>Bad Gateway</html>");

    const result = await run(avisoInputs);

    expect(result.status).toBe("error");
    expect(result.error).toContain("HTTP 502");
  });

  it("fails without leaking the token when the request itself throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error(`connect ECONNRESET Bearer ${TOKEN}`);
      })
    );

    const result = await run(avisoInputs);

    expect(result.status).toBe("error");
    expect(result.error).toContain("ECONNRESET");
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("fails when a 2xx reply carries no message id", async () => {
    graphReplies(200, { messages: [] });

    const result = await run(avisoInputs);

    expect(result.status).toBe("error");
    expect(result.error).toContain("no message id");
  });

  it.each([
    CNB_WHATSAPP_ACCESS_TOKEN,
    CNB_WHATSAPP_PHONE_NUMBER_ID,
  ])("fails naming %s when that Worker secret is missing, without calling Meta", async (missing) => {
    const fetchMock = graphReplies(200, { messages: [{ id: "wamid.X" }] });
    const env: Record<string, string> = { ...secrets };
    delete env[missing];

    const result = await run(avisoInputs, env);

    expect(result.status).toBe("error");
    expect(result.error).toContain(missing);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["telefone is not digits", { ...avisoInputs, telefone: "(93) 99123-4567" }],
    [
      "unidade is missing",
      { ...avisoInputs, variaveis: { primeiro_nome: "Maria" } },
    ],
    ["variaveis is missing", { telefone: avisoInputs.telefone }],
  ])("rejects the input when %s, without calling Meta", async (_case, inputs) => {
    const fetchMock = graphReplies(200, { messages: [{ id: "wamid.X" }] });

    const result = await run(inputs);

    expect(result.status).toBe("error");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
