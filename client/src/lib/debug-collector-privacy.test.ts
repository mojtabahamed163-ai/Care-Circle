import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

type CollectorHooks = {
  sanitizeText: (value: unknown, maxLength?: number) => string;
  sanitizeValue: (value: unknown) => unknown;
  safeUrl: (value: string) => string;
  isPrivateApiUrl: (value: string) => boolean;
  redactNetworkValue: (url: string, value: unknown) => unknown;
};

function loadCollectorHooks(): CollectorHooks {
  const source = readFileSync(
    resolve(import.meta.dirname, "../../public/__manus__/debug-collector.js"),
    "utf8"
  );
  const window = {
    __MANUS_DEBUG_COLLECTOR_TEST__: true,
    location: { origin: "https://care.example" },
  } as Record<string, unknown>;
  vm.runInNewContext(source, {
    window,
    URL,
    console,
    Date,
    Intl,
  });
  return window.__MANUS_DEBUG_COLLECTOR_TEST_HOOKS__ as CollectorHooks;
}

describe("debug collector privacy guards", () => {
  it("redacts care fields, email addresses, invite tokens, and long tokens", () => {
    const hooks = loadCollectorHooks();
    const value = hooks.sanitizeValue({
      medicationName: "Night medicine",
      dose: "10 mg",
      notes: "Private visit note",
      nested: { phone: "+1 555 0100", safeStatus: "ok" },
    }) as Record<string, unknown>;
    const text = hooks.sanitizeText(
      "Contact alice@example.com at /invite/super-secret-token with Bearer abcdefghijklmnopqrstuvwxyz123456"
    );

    expect(JSON.stringify(value)).not.toContain("Night medicine");
    expect(JSON.stringify(value)).not.toContain("Private visit note");
    expect(JSON.stringify(value)).not.toContain("+1 555 0100");
    expect((value.nested as Record<string, unknown>).safeStatus).toBe("ok");
    expect(text).not.toContain("alice@example.com");
    expect(text).not.toContain("super-secret-token");
    expect(text).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    expect(text).toContain("[REDACTED_EMAIL]");
    expect(text).toContain("[REDACTED_TOKEN]");
  });

  it("removes query strings and invite tokens from diagnostic URLs", () => {
    const hooks = loadCollectorHooks();

    expect(
      hooks.safeUrl(
        "https://care.example/invite/super-secret?token=abc#private"
      )
    ).toBe("https://care.example/invite/[REDACTED]");
    expect(hooks.safeUrl("/dashboard?familyId=123")).toBe(
      "https://care.example/dashboard"
    );
  });

  it("uses the same full redaction rule for fetch and XMLHttpRequest API data", () => {
    const hooks = loadCollectorHooks();
    const sensitivePayload = {
      json: {
        medicationName: "Night medicine",
        dose: "10 mg",
        visitNotes: "Private note",
      },
      headers: { authorization: "Bearer secret" },
    };

    expect(hooks.isPrivateApiUrl("/api/trpc/care.medications.list")).toBe(true);
    expect(hooks.isPrivateApiUrl("/assets/logo.svg")).toBe(false);
    expect(
      hooks.redactNetworkValue(
        "/api/trpc/care.medications.list",
        sensitivePayload
      )
    ).toBe("[REDACTED]");
    expect(
      hooks.redactNetworkValue("/assets/logo.svg", {
        authorization: "Bearer secret",
        status: "ok",
      })
    ).toEqual({ authorization: "[REDACTED]", status: "ok" });
  });
});
