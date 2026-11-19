import assert from "node:assert/strict";
import { test } from "node:test";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { createServer } from "node:http";
import { JwtVerifier } from "../src/auth/jwt-verifier.js";
import { ProblemError, problemFromDatabaseError } from "../src/common/problem.js";
import { loadConfig } from "../src/config.js";
import { JWT_SECRET, SUPABASE_URL, tokenFor } from "./helpers.js";

const user = { id: "6f1d1f0c-6c86-4a43-8f3a-4f2f4d1c9b11", email: "a@test.invalid" };
const supabase = { url: SUPABASE_URL, issuer: `${SUPABASE_URL}/auth/v1`, jwksUrl: `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`, jwtSecret: JWT_SECRET };

async function rejectsWith(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (e: unknown) => e instanceof ProblemError && e.code === code);
}

test("acepta un token válido de Supabase y extrae usuario y aal", async () => {
  const ctx = await new JwtVerifier(supabase).verify(await tokenFor(user, { aal: "aal2" }));
  assert.equal(ctx.userId, user.id);
  assert.equal(ctx.aal, "aal2");
});

test("rechaza tokens caducados, con otra audiencia, otro emisor, otro rol u otra firma", async () => {
  const v = new JwtVerifier(supabase);
  await rejectsWith(v.verify(await tokenFor(user, { expiresIn: "-1m" })), "unauthenticated");
  await rejectsWith(v.verify(await tokenFor(user, { audience: "otra" })), "unauthenticated");
  await rejectsWith(v.verify(await tokenFor(user, { issuer: "https://evil.invalid/auth/v1" })), "unauthenticated");
  await rejectsWith(v.verify(await tokenFor(user, { role: "service_role" })), "unauthenticated");
  await rejectsWith(v.verify(await tokenFor(user, { secret: "otro-secreto-cualquiera-de-32-caracteres!!" })), "unauthenticated");
  await rejectsWith(v.verify("no-es-un-jwt"), "unauthenticated");
});

test("sin secreto HS256 configurado, un token HS256 no se acepta", async () => {
  const { jwtSecret: _ignored, ...withoutSecret } = supabase;
  await rejectsWith(new JwtVerifier(withoutSecret).verify(await tokenFor(user)), "unauthenticated");
});

test("verifica tokens ES256 con las claves públicas (JWKS) del proyecto", async () => {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256", use: "sig" };
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const url = `http://127.0.0.1:${port}`;
    const verifier = new JwtVerifier({ url, issuer: `${url}/auth/v1`, jwksUrl: `${url}/jwks` });
    const token = await new SignJWT({ role: "authenticated", aal: "aal1" })
      .setProtectedHeader({ alg: "ES256", kid: "k1" })
      .setSubject(user.id)
      .setIssuer(`${url}/auth/v1`)
      .setAudience("authenticated")
      .setExpirationTime("5m")
      .sign(privateKey);
    const ctx = await verifier.verify(token);
    assert.equal(ctx.aal, "aal1");
  } finally {
    server.close();
  }
});

test("traduce errores SQL de CAPTIA a errores HTTP y oculta los desconocidos", () => {
  assert.equal(problemFromDatabaseError({ code: "CA401", message: "mfa_required" })?.status, 401);
  assert.equal(problemFromDatabaseError({ code: "CA404", message: "organization_not_found" })?.code, "organization_not_found");
  assert.equal(problemFromDatabaseError({ code: "CA409", message: "algo_raro" })?.code, "conflict");
  assert.equal(problemFromDatabaseError({ code: "42501", message: "permission denied for table x" })?.status, 403);
  assert.equal(problemFromDatabaseError({ code: "XX000", message: "boom" }), null);
  assert.equal(problemFromDatabaseError(new Error("x")), null);
});

test("la configuración exige DATABASE_URL y SUPABASE_URL y deriva emisor y JWKS", () => {
  assert.throws(() => loadConfig({}), /DATABASE_URL/);
  const c = loadConfig({ DATABASE_URL: "postgres://x", SUPABASE_URL: "https://abc.supabase.co/" });
  assert.equal(c.supabase.issuer, "https://abc.supabase.co/auth/v1");
  assert.equal(c.supabase.jwksUrl, "https://abc.supabase.co/auth/v1/.well-known/jwks.json");
  assert.equal(c.supabase.serviceRoleKey, undefined);
});
