import type { CookieOptions, Request } from "express";

type HeaderValue = string | string[] | undefined;

function firstHeader(value: HeaderValue) {
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

export function getSessionCookieOptions(req: Request): CookieOptions {
  const forwardedProto = firstHeader(req.headers["x-forwarded-proto"]);
  const forwardedHost = firstHeader(req.headers["x-forwarded-host"]);
  const requestHost = req.hostname || req.headers.host || "";
  const isPlainHttpLocal =
    isLoopbackHost(requestHost) &&
    (!forwardedHost || isLoopbackHost(forwardedHost)) &&
    forwardedProto !== "https";

  // Cloud Preview is public HTTPS even if its upstream hop reaches this server
  // over HTTP. Only direct, plain-HTTP loopback development uses Lax/no-Secure.
  return {
    httpOnly: true,
    path: "/",
    sameSite: isPlainHttpLocal ? "lax" : "none",
    secure: !isPlainHttpLocal,
  };
}
