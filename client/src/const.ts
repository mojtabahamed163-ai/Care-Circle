import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_COOKIE_LOCAL,
  encodeOAuthState,
} from "@shared/const";

export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Start the Manus OAuth login. Call this from an event handler or effect at the
// moment you want to navigate, e.g. `onClick={() => startLogin()}`.
//
// It has SIDE EFFECTS — it mints a one-time nonce, writes the __Host- state
// cookie, and navigates immediately — so the cookie nonce always matches the
// `state` it sends. Do NOT call it during render (no `href={startLogin()}` /
// `loginUrl={...}`): each call overwrites the cookie, so a stray render-phase
// call would desync it from an in-flight login and the callback would reject it
// with "invalid oauth state". It returns void by design, so there is no URL to
// stash across renders.
export const startLogin = () => {
  const oauthPortalUrl = window.__MANUS_CONFIG__?.oauthPortalUrl;
  const appId = window.__MANUS_CONFIG__?.projectId;
  if (!oauthPortalUrl || !appId)
    throw new Error("Manus login is not configured");
  const redirectUri = `${window.location.origin}/api/oauth/callback`;

  const nonce = crypto.randomUUID();
  const localHttp =
    window.location.protocol === "http:" &&
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
      window.location.hostname
    );
  const cookieName = localHttp ? OAUTH_STATE_COOKIE_LOCAL : OAUTH_STATE_COOKIE;
  const cookieOptions = localHttp ? "SameSite=Lax" : "SameSite=None; Secure";
  document.cookie = `${cookieName}=${nonce}; Path=/; Max-Age=600; ${cookieOptions}`;
  const state = encodeOAuthState({ redirectUri, nonce, localHttp });

  const url = new URL(`${oauthPortalUrl}/app-auth`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("responseType", "code");

  window.location.href = url.toString();
};
