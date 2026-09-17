import { describe, expect, it } from "vitest";
import fixture from "./bridge-contract.json";
import { signHandoff } from "../../src/remote/product-bridge.js";
import { readConfig } from "../../src/remote/config.js";

describe("product bridge contract", () => {
  it("signs the shared Rails contract vector without serialization drift", () => {
    expect(signHandoff(fixture.fixture.claims, fixture.fixture.secret)).toBe(
      fixture.fixture.signed_handoff,
    );
  });
  it("rejects missing production secrets and insecure origins", () => {
    expect(() => readConfig({})).toThrow();
    expect(() => readConfig({ MCP_ISSUER: "http://example.com" })).toThrow();
  });
});
