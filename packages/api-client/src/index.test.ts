import assert from "node:assert/strict";
import { test } from "node:test";
import { CaptiaApiClient, CaptiaApiError } from "./index.js";

function fakeFetch(status: number, body: unknown, seen: { url?: string; init?: RequestInit } = {}): typeof fetch {
  return (async (url: URL | RequestInfo, init?: RequestInit) => {
    seen.url = String(url);
    seen.init = init;
    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

const org = {
  id: "8d7b1c3e-2a4f-4e6a-9b1c-1234567890ab",
  name: "Empresa",
  slug: "empresa",
  status: "active",
  createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z",
};

test("envía el token y la clave de idempotencia", async () => {
  const seen: { url?: string; init?: RequestInit } = {};
  const client = new CaptiaApiClient({ baseUrl: "http://api.test/", accessToken: "tok", fetch: fakeFetch(201, org, seen) });
  const created = await client.createOrganization({ name: "Empresa", slug: "empresa" }, "clave-123456");
  assert.equal(created.id, org.id);
  assert.equal(seen.url, "http://api.test/v1/organizations");
  const headers = seen.init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer tok");
  assert.equal(headers["Idempotency-Key"], "clave-123456");
});

test("convierte un problem+json en CaptiaApiError", async () => {
  const client = new CaptiaApiClient({
    baseUrl: "http://api.test",
    fetch: fakeFetch(403, { type: "about:blank", title: "Prohibido", status: 403, code: "forbidden" }),
  });
  await assert.rejects(client.listOrganizations(), (error: unknown) => {
    assert.ok(error instanceof CaptiaApiError);
    assert.equal(error.status, 403);
    assert.equal(error.code, "forbidden");
    return true;
  });
});

test("rechaza respuestas que no cumplen el contrato", async () => {
  const client = new CaptiaApiClient({ baseUrl: "http://api.test", fetch: fakeFetch(200, { data: [{ id: "no-uuid" }] }) });
  await assert.rejects(client.listOrganizations());
});

test("omite parámetros vacíos de la consulta", async () => {
  const seen: { url?: string } = {};
  const client = new CaptiaApiClient({ baseUrl: "http://api.test", fetch: fakeFetch(200, { data: [] }, seen) });
  await client.platformAudit({ limit: 10, before: undefined });
  assert.equal(seen.url, "http://api.test/v1/platform/audit-events?limit=10");
});
