import assert from "node:assert/strict";
import { test } from "node:test";
import { AddMemberSchema, CreateOrganizationSchema, ERROR_CODES, PageQuerySchema, UpdateMemberSchema } from "./index.js";

test("normaliza el slug y aplica valores por defecto", () => {
  const parsed = CreateOrganizationSchema.parse({ name: "  Empresa 001 ", slug: "Empresa-001" });
  assert.deepEqual(parsed, { name: "Empresa 001", slug: "empresa-001", addCreatorAsMember: true });
});

test("rechaza slugs con caracteres no permitidos", () => {
  assert.equal(CreateOrganizationSchema.safeParse({ name: "Ok", slug: "mala slug" }).success, false);
  assert.equal(CreateOrganizationSchema.safeParse({ name: "Ok", slug: "-x" }).success, false);
});

test("normaliza el correo de un miembro", () => {
  const parsed = AddMemberSchema.parse({ email: " Ana@Example.COM ", roleKey: "operator" });
  assert.equal(parsed.email, "ana@example.com");
  assert.equal(parsed.invite, false);
});

test("una actualización vacía no es válida", () => {
  assert.equal(UpdateMemberSchema.safeParse({}).success, false);
});

test("la paginación limita el tamaño de página", () => {
  assert.equal(PageQuerySchema.parse({}).limit, 50);
  assert.equal(PageQuerySchema.safeParse({ limit: "500" }).success, false);
});

test("cada código de error tiene un estado HTTP válido", () => {
  for (const status of Object.values(ERROR_CODES)) assert.ok(status >= 400 && status < 600);
});
