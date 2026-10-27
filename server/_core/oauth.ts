import {
  COOKIE_NAME,
  ONE_YEAR_MS,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_COOKIE_LOCAL,
  decodeOAuthState,
} from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

function firstForwarded(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value)?.split(",")[0]?.trim();
}

function isLoopbackHost(host: string) {
  const normalized = host.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.startsWith("localhost:") ||
    normalized === "127.0.0.1" ||
    normalized.startsWith("127.0.0.1:") ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized.startsWith("[::1]:")
  );
}

function isLocalHttpOAuth(
  req: Request,
  redirectUri: string,
  localHttp?: boolean
) {
  if (!localHttp) return false;
  let redirect: URL;
  try {
    redirect = new URL(redirectUri);
  } catch {
    return false;
  }
  const forwardedHost = firstForwarded(req.headers["x-forwarded-host"]);
  const callbackHost = req.hostname || req.headers.host || "";
  const forwardedProto = firstForwarded(req.headers["x-forwarded-proto"]);
  return (
    redirect.protocol === "http:" &&
    isLoopbackHost(redirect.hostname) &&
    isLoopbackHost(callbackHost) &&
    (!forwardedHost || isLoopbackHost(forwardedHost)) &&
    forwardedProto !== "https"
  );
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    // Bind the nonce to the browser that started login. The local cookie is
    // accepted only for an explicit HTTP loopback callback, never for Preview.
    const oauthState = decodeOAuthState(state);
    const localHttp = isLocalHttpOAuth(
      req,
      oauthState.redirectUri,
      oauthState.localHttp
    );
    const stateCookie = localHttp
      ? OAUTH_STATE_COOKIE_LOCAL
      : OAUTH_STATE_COOKIE;
    const expectedNonce = parseCookieHeader(req.headers.cookie ?? "")[
      stateCookie
    ];
    if (!oauthState.nonce || oauthState.nonce !== expectedNonce) {
      res.status(403).json({ error: "invalid oauth state" });
      return;
    }

    res.clearCookie(
      stateCookie,
      localHttp
        ? { path: "/", sameSite: "lax" }
        : { path: "/", secure: true, sameSite: "none" }
    );

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }

      await db.upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, {
        ...cookieOptions,
        maxAge: ONE_YEAR_MS,
      });

      res.redirect(302, "/");
    } catch (error) {
      console.error(
        "[OAuth] Callback failed",
        error instanceof Error ? error.message : "unknown error"
      );
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}
