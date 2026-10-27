import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { getSessionCookieOptions } from "./_core/cookies";

function request(
  host: string,
  forwardedProto?: string,
  forwardedHost?: string
) {
  return {
    hostname: host,
    headers: {
      host,
      ...(forwardedProto ? { "x-forwarded-proto": forwardedProto } : {}),
      ...(forwardedHost ? { "x-forwarded-host": forwardedHost } : {}),
    },
  } as Request;
}

describe("application session cookie options", () => {
  it("keeps public HTTPS Preview eligible inside its cross-site iframe", () => {
    expect(
      getSessionCookieOptions(
        request("localhost", "https", "8328-preview.us3.manus.computer")
      )
    ).toMatchObject({ sameSite: "none", secure: true, httpOnly: true });
  });

  it("uses a separate plain-HTTP-safe setting on local loopback development", () => {
    expect(
      getSessionCookieOptions(request("localhost:3000", "http"))
    ).toMatchObject({
      sameSite: "lax",
      secure: false,
      httpOnly: true,
    });
  });

  it("does not infer insecurity from an internal HTTP hop on a public host", () => {
    expect(
      getSessionCookieOptions(request("localhost", "http", "care.example.com"))
    ).toMatchObject({ sameSite: "none", secure: true });
  });

  it("does not let a forged loopback forwarded host weaken a public request", () => {
    expect(
      getSessionCookieOptions(request("care.example.com", "http", "localhost"))
    ).toMatchObject({ sameSite: "none", secure: true });
  });
});
