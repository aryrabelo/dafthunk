import type { Node } from "@dafthunk/types";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import {
  isExecutionPreparationError,
  prepareWorkflowExecution,
} from "./execution-preparation";

const triggerNode = {
  id: "trigger",
  name: "HTTP Request",
  type: "http-request",
  position: { x: 0, y: 0 },
  inputs: [],
  outputs: [],
} as unknown as Node;

async function preparedHeaders(
  headers: Record<string, string>
): Promise<Record<string, string>> {
  const app = new Hono();
  app.post("/http/:id", async (c) => {
    const result = await prepareWorkflowExecution(c, {
      trigger: "http_request",
      nodes: [triggerNode],
      edges: [],
    });
    if (isExecutionPreparationError(result)) {
      throw new Error(String(result.error));
    }
    return c.json(result.parameters);
  });
  const res = await app.request("/http/wf-1", {
    method: "POST",
    headers,
    body: JSON.stringify({ telefone: "5593999999999" }),
  });
  const parameters = (await res.json()) as { headers: Record<string, string> };
  return parameters.headers;
}

describe("prepareWorkflowExecution", () => {
  it("drops credential headers from the trigger parameters", async () => {
    const headers = await preparedHeaders({
      Authorization: "Bearer dk_secret",
      Cookie: "access_token=secret",
      "X-API-Key": "dk_secret",
      "Proxy-Authorization": "Basic c2VjcmV0",
      "Content-Type": "application/json",
      "X-Request-Id": "abc-123",
    });

    expect(headers).toEqual({
      "content-type": "application/json",
      "x-request-id": "abc-123",
    });
  });
});
