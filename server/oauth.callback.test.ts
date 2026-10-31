import type { Express, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  COOKIE_NAME,
  OAUTH_STATE_COOKIE,
  ONE_YEAR_MS,
  encodeOAuthState,
} from "../shared/const";

const oauthMocks = vi.hoisted(() => ({
  exchangeCodeForToken: vi.fn(),
  getUserInfo: vi.fn(),
  createSessionToken: vi.fn(),
}));
const databaseMocks = vi.hoisted(() => ({
  upsertUser: vi.fn(),
}));

vi.mock("./_core/sdk", () => ({ sdk: oauthMocks }));
vi.mock("./db", () => databaseMocks);

import { registerOAuthRoutes } from "./_core/oauth";

function callbackHandler() {
  const handlers = new Map<string, (req: Request, res: Response) => unknown>();
  const app = {
    get(path: string, handler: (req: Request, res: Response) => unknown) {
      handlers.set(path, handler);
    },
  } as unknown as Express;
  registerOAuthRoutes(app);
  const handler = handlers.get("/api/oauth/callback");
  if (!handler) throw new Error("OAuth callback route was not registered.");
  return handler;
}

function makeRequest(state: string, nonceCookie: string): Request {
  return {
    query: { code: "test-authorization-code", state },
    hostname: "care.example.test",
    headers: {
      host: "care.example.test",
      cookie: `${OAUTH_STATE_COOKIE}=${nonceCookie}`,
      "x-forwarded-host": "care.example.test",
      "x-forwarded-proto": "https",
    },
  } as unknown as Request;
}

function makeResponse() {
  const result: Record<string, any> = {
    statusCode: 200,
    body: undefined,
    redirectTarget: undefined,
    clearCookie: vi.fn(),
    cookie: vi.fn(),
    status(code: number) {
      result.statusCode = code;
      return result;
    },
    json(body: unknown) {
      result.body = body;
      return result;
    },
    redirect(code: number, target: string) {
      result.statusCode = code;
      result.redirectTarget = target;
      return result;
    },
  };
  return result as unknown as Response & typeof result;
}

describe("Manus OAuth callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    oauthMocks.exchangeCodeForToken.mockResolvedValue({
      accessToken: "mock-access-token",
    });
    oauthMocks.getUserInfo.mockResolvedValue({
      openId: "mocked-manus-open-id",
      name: "Test Sign-in User",
      email: "signin@example.test",
      platform: "manus",
      loginMethod: "manus",
    });
    oauthMocks.createSessionToken.mockResolvedValue("mock-signed-session");
    databaseMocks.upsertUser.mockResolvedValue(undefined);
  });

  it("validates the nonce, upserts the OAuth identity, sets the Preview-compatible session and redirects locally", async () => {
    const nonce = "a-single-use-test-nonce";
    const state = encodeOAuthState({
      redirectUri: "https://care.example.test/api/oauth/callback",
      nonce,
    });
    const response = makeResponse();
    await callbackHandler()(makeRequest(state, nonce), response);

    expect(oauthMocks.exchangeCodeForToken).toHaveBeenCalledWith(
      "test-authorization-code",
      state
    );
    expect(oauthMocks.getUserInfo).toHaveBeenCalledWith("mock-access-token");
    expect(databaseMocks.upsertUser).toHaveBeenCalledWith(
      expect.objectContaining({
        openId: "mocked-manus-open-id",
        name: "Test Sign-in User",
        email: "signin@example.test",
        loginMethod: "manus",
        lastSignedIn: expect.any(Date),
      })
    );
    expect(response.clearCookie).toHaveBeenCalledWith(
      OAUTH_STATE_COOKIE,
      expect.objectContaining({ path: "/", secure: true, sameSite: "none" })
    );
    expect(response.cookie).toHaveBeenCalledWith(
      COOKIE_NAME,
      "mock-signed-session",
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: "none",
        maxAge: ONE_YEAR_MS,
        path: "/",
      })
    );
    expect(response.redirectTarget).toBe("/");
    expect(response.statusCode).toBe(302);
  });

  it("rejects a mismatched nonce before exchanging the authorization code", async () => {
    const state = encodeOAuthState({
      redirectUri: "https://care.example.test/api/oauth/callback",
      nonce: "state-nonce",
    });
    const response = makeResponse();
    await callbackHandler()(
      makeRequest(state, "different-cookie-nonce"),
      response
    );

    expect(response.statusCode).toBe(403);
    expect(response.body).toEqual({ error: "invalid oauth state" });
    expect(oauthMocks.exchangeCodeForToken).not.toHaveBeenCalled();
    expect(databaseMocks.upsertUser).not.toHaveBeenCalled();
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it("rejects callbacks without the required code or state", async () => {
    const response = makeResponse();
    const request = {
      query: { code: "", state: "" },
      hostname: "care.example.test",
      headers: { host: "care.example.test" },
    } as unknown as Request;
    await callbackHandler()(request, response);

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: "code and state are required" });
    expect(oauthMocks.exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it("rejects malformed state as a CSRF failure instead of throwing", async () => {
    const response = makeResponse();
    await callbackHandler()(
      makeRequest("not-valid-base64-state", "some-nonce"),
      response
    );

    expect(response.statusCode).toBe(403);
    expect(response.body).toEqual({ error: "invalid oauth state" });
    expect(oauthMocks.exchangeCodeForToken).not.toHaveBeenCalled();
    expect(databaseMocks.upsertUser).not.toHaveBeenCalled();
  });
});
