import assert from "node:assert/strict";
import test from "node:test";

import { corsHeaders } from "../src/http.js";

test("allows the public site and local development origins", () => {
  assert.equal(originHeader("https://pqattest.com"), "https://pqattest.com");
  assert.equal(originHeader("http://127.0.0.1:4321"), "http://127.0.0.1:4321");
  assert.equal(originHeader("http://localhost:4321"), "http://localhost:4321");
  assert.equal(originHeader("https://evil.example"), null);
});

function originHeader(origin: string): string | null {
  return corsHeaders(new Request("https://experiments.pqattest.com/", { headers: { origin } })).get(
    "access-control-allow-origin",
  );
}
