import { describe, expect, it } from "vitest";

import auth from "./auth";

async function logoutCookies(env: {
  WEB_HOST: string;
  COOKIE_DOMAIN?: string;
}): Promise<string[]> {
  const res = await auth.request("/logout", { method: "POST" }, env);
  return res.headers.getSetCookie();
}

describe("auth cookie domain", () => {
  it("scopes cookies to the parent domain of a regular host", async () => {
    const cookies = await logoutCookies({
      WEB_HOST: "https://app.dafthunk.com",
    });
    expect(cookies).toHaveLength(2);
    for (const cookie of cookies) {
      expect(cookie).toContain("Domain=dafthunk.com");
    }
  });

  it("falls back to a host-only cookie when the parent is a public suffix", async () => {
    for (const host of [
      "https://workflows.clinicanobairro.com.br",
      "https://app.example.co.uk",
      "https://app.example.com.au",
      "https://app.example.org.ar",
    ]) {
      const cookies = await logoutCookies({ WEB_HOST: host });
      expect(cookies).toHaveLength(2);
      for (const cookie of cookies) {
        expect(cookie).not.toMatch(/Domain=/i);
      }
    }
  });

  it("uses COOKIE_DOMAIN when set", async () => {
    const cookies = await logoutCookies({
      WEB_HOST: "https://workflows.clinicanobairro.com.br",
      COOKIE_DOMAIN: "clinicanobairro.com.br",
    });
    expect(cookies).toHaveLength(2);
    for (const cookie of cookies) {
      expect(cookie).toContain("Domain=clinicanobairro.com.br");
    }
  });
});
