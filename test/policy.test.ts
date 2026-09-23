import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_ATTEST_PRICE_USDC,
  discoveryDocument,
  endpointPolicies,
  loadPaymentConfig,
  microUsdc,
  openApiDocument,
} from "../src/policy.ts";

describe("payment policy", () => {
  it("charges attest and leaves verify and discovery free", () => {
    const access = new Map(endpointPolicies.map((endpoint) => [`${endpoint.method} ${endpoint.path}`, endpoint.access]));
    assert.equal(access.get("POST /attest"), "paid");
    assert.equal(access.get("POST /verify"), "free");
    assert.equal(access.get("GET /discovery"), "free");
    assert.equal(access.get("GET /openapi.json"), "free");
    assert.equal(access.get("GET /health"), "free");
    assert.equal(access.get("GET /ready"), "free");
  });

  it("converts 0.0001 USDC into 100 micro-USDC", () => {
    assert.equal(DEFAULT_ATTEST_PRICE_USDC, "0.0001");
    assert.equal(microUsdc("0.0001"), "100");
    assert.equal(microUsdc("1"), "1000000");
    assert.equal(microUsdc("0.01"), "10000");
    assert.throws(() => microUsdc("0.0000001"), /decimal places/);
  });

  it("builds discovery and OpenAPI from the shared price", () => {
    const config = loadPaymentConfig({
      X402_PAY_TO: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ",
      X402_PRICE_ATTEST_USDC: "0.0001",
    });
    const discovery = discoveryDocument(config);
    const attest = discovery.endpoints.find((endpoint) => endpoint.path === "/attest");
    const verify = discovery.endpoints.find((endpoint) => endpoint.path === "/verify");
    assert.equal(discovery.x402Version, 2);
    assert.equal(discovery.accepts[0]?.maxAmountRequired, "100");
    assert.equal(discovery.accepts[0]?.asset, "31566704");
    assert.equal(attest?.access, "paid");
    assert.equal(verify?.access, "free");
    assert.deepEqual(discovery.paymentHeaders, [
      "PAYMENT-REQUIRED",
      "PAYMENT-SIGNATURE",
      "PAYMENT-RESPONSE",
    ]);

    const openapi = openApiDocument(config);
    const operation = openapi.paths["/attest"].post;
    assert.equal(operation.responses["402"].description.includes("PAYMENT-REQUIRED"), true);
    assert.equal(operation["x-x402"].maxAmountRequired, "100");
    assert.equal(operation["x-x402"].priceUsdc, "0.0001");
    assert.equal("402" in openapi.paths["/verify"].post.responses, false);
  });
});
