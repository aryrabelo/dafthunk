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

  it("sends to the Graph API under CNB_WHATSAPP_BASE_URL when it is set", async () => {
    const fetchMock = graphReplies(200, { messages: [{ id: "wamid.X" }] });

    await run(avisoInputs, {
      ...secrets,
      CNB_WHATSAPP_PROVIDER: "meta",
      CNB_WHATSAPP_BASE_URL: "https://graph.example.test/",
    });

    expect(sentRequest(fetchMock).url).toBe(
      `https://graph.example.test/v21.0/${PHONE_NUMBER_ID}/messages`
    );
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
    expect(result.error).toContain("provider meta code 131026");
    expect(result.error).toContain("HTTP 400");
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("fails with the HTTP status when the Graph API error is not JSON", async () => {
    graphReplies(502, "<html>Bad Gateway</html>");

    const result = await run(avisoInputs);

    expect(result.status).toBe("error");
    expect(result.error).toContain("provider meta code 502");
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

const WAHA_KEY = "waha-secret-key-do-not-leak";
const WAHA_BASE = "https://waha.example.test";

const wahaEnv: Record<string, string> = {
  CNB_WHATSAPP_PROVIDER: "waha",
  CNB_WHATSAPP_BASE_URL: `${WAHA_BASE}/`,
  CNB_WAHA_API_KEY: WAHA_KEY,
  CNB_WAHA_SESSION: "cnb-aviso-teste",
  CNB_WHATSAPP_DESTINOS_PERMITIDOS: " +55 (93) 99123-4567 , 5593999990001",
};

const D7_TEXT =
  "Olá, Maria! Os resultados dos seus exames na Clínica No Bairro estão prontos. " +
  "Você pode consultá-los pelo portal ou retirar na unidade Centro.\n\n" +
  "https://clinicanobairro.com.br/resultados\n\n" +
  "Para não receber mais avisos, responda PARAR.";

describe("CnbWhatsAppTemplateNode with the waha provider", () => {
  it("sends the rendered D7 text through sendText and returns the WAHA id as messageId", async () => {
    const fetchMock = graphReplies(201, {
      id: "true_5593991234567@c.us_3EB0AAAA",
      fromMe: true,
      body: D7_TEXT,
    });

    const result = await run(avisoInputs, wahaEnv);

    expect(result.status).toBe("completed");
    expect(result.outputs).toEqual({
      messageId: "true_5593991234567@c.us_3EB0AAAA",
    });
    const request = sentRequest(fetchMock);
    expect(request.url).toBe(`${WAHA_BASE}/api/sendText`);
    expect(request.method).toBe("POST");
    expect(request.headers.get("x-api-key")).toBe(WAHA_KEY);
    expect(request.headers.get("content-type")).toBe("application/json");
    expect(request.headers.get("authorization")).toBeNull();
    expect(request.body).toEqual({
      session: "cnb-aviso-teste",
      chatId: "5593991234567@c.us",
      text: D7_TEXT,
    });
    expect(JSON.stringify(result)).not.toContain(WAHA_KEY);
  });

  it("reads messageId from id._serialized when WAHA returns the id as an object", async () => {
    graphReplies(201, {
      id: {
        fromMe: true,
        remote: "5593991234567@c.us",
        id: "3EB0BBBB",
        _serialized: "true_5593991234567@c.us_3EB0BBBB",
      },
    });

    const result = await run(avisoInputs, wahaEnv);

    expect(result.status).toBe("completed");
    expect(result.outputs).toEqual({
      messageId: "true_5593991234567@c.us_3EB0BBBB",
    });
  });

  it("fails with provider waha code 422 when the session is not WORKING, without leaking the key", async () => {
    graphReplies(422, {
      statusCode: 422,
      message: `Session status is not as expected. X-Api-Key: ${WAHA_KEY}`,
      error: "Unprocessable Entity",
    });

    const result = await run(avisoInputs, wahaEnv);

    expect(result.status).toBe("error");
    expect(result.error).toContain("provider waha code 422");
    expect(result.error).toContain("Session status is not as expected");
    expect(JSON.stringify(result)).not.toContain(WAHA_KEY);
  });

  it("prefers the WAHA error code over the HTTP status when the body carries one", async () => {
    graphReplies(400, { code: 475, message: "Rate limit" });

    const result = await run(avisoInputs, wahaEnv);

    expect(result.status).toBe("error");
    expect(result.error).toContain("provider waha code 475");
  });

  it("fails without leaking the key when the request to WAHA throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error(`connect ECONNREFUSED key=${WAHA_KEY}`);
      })
    );

    const result = await run(avisoInputs, wahaEnv);

    expect(result.status).toBe("error");
    expect(result.error).toContain("provider waha");
    expect(result.error).toContain("ECONNREFUSED");
    expect(JSON.stringify(result)).not.toContain(WAHA_KEY);
  });

  it("fails when a 2xx WAHA reply carries no id", async () => {
    graphReplies(201, { fromMe: true });

    const result = await run(avisoInputs, wahaEnv);

    expect(result.status).toBe("error");
    expect(result.error).toContain("provider waha");
    expect(result.error).toContain("no message id");
  });

  it.each([
    ["outside the list", "5593999990001, 5593999990003"],
    ["the list is empty", " , "],
  ])("refuses a destination when %s, before any call to WAHA", async (_case, lista) => {
    const fetchMock = graphReplies(201, { id: "never" });

    const result = await run(avisoInputs, {
      ...wahaEnv,
      CNB_WHATSAPP_DESTINOS_PERMITIDOS: lista,
    });

    expect(result.status).toBe("error");
    expect(result.error).toContain("provider waha code destino_nao_permitido");
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("refuses every destination when the allow-list is unset", async () => {
    const fetchMock = graphReplies(201, { id: "never" });
    const env = { ...wahaEnv };
    delete env.CNB_WHATSAPP_DESTINOS_PERMITIDOS;

    const result = await run(avisoInputs, env);

    expect(result.status).toBe("error");
    expect(result.error).toContain("provider waha code destino_nao_permitido");
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it.each([
    "CNB_WHATSAPP_BASE_URL",
    "CNB_WAHA_API_KEY",
    "CNB_WAHA_SESSION",
  ])("fails naming %s when it is missing, without calling WAHA", async (missing) => {
    const fetchMock = graphReplies(201, { id: "never" });
    const env = { ...wahaEnv };
    delete env[missing];

    const result = await run(avisoInputs, env);

    expect(result.status).toBe("error");
    expect(result.error).toContain(missing);
    expect(result.error).toContain("waha");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a template other than aviso_resultado, since WAHA only has the D7 text", async () => {
    const fetchMock = graphReplies(201, { id: "never" });

    const result = await run({ ...avisoInputs, template: "lembrete" }, wahaEnv);

    expect(result.status).toBe("error");
    expect(result.error).toContain("provider waha code template_desconhecido");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("CnbWhatsAppTemplateNode provider selection", () => {
  it("rejects an unknown CNB_WHATSAPP_PROVIDER without calling anything", async () => {
    const fetchMock = graphReplies(200, { messages: [{ id: "wamid.X" }] });

    const result = await run(avisoInputs, {
      ...secrets,
      CNB_WHATSAPP_PROVIDER: "twilio",
    });

    expect(result.status).toBe("error");
    expect(result.error).toContain("CNB_WHATSAPP_PROVIDER");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
