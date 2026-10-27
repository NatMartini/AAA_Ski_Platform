import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePrismaAlignment as normalize } from "./prisma-schema-identity.mjs";

test("generated column alignment and CRLF do not require replacing a loaded DLL", () => {
  assert.equal(normalize('model User {\r\n  id    String  @id\r\n}'), normalize('model User {\n id String @id\n}'));
});
test("schema type, token boundaries, quoted defaults and escaped quotes remain distinct", () => {
  for (const [left, right] of [
    ['id String', 'id Int'], ['ab Cd', 'a bCd'],
    ['name String @default("a  b")', 'name String @default("a b")'],
    ['name String @default("a\\\"  b")', 'name String @default("a\\\" b")'],
  ]) assert.notEqual(normalize(left), normalize(right));
});
