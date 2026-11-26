/**
 * GitHub OAuth App web flow client.
 * Verified against github/docs source (content/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps.md,
 * fetched 26/11/2026): PKCE is supported on github.com with code_challenge_method=S256 only ("plain" is not
 * supported); authorization codes expire after 10 minutes; requesting no scope grants read-only access to
 * public information, which is enough for GET /user (id, login).
 */

export interface GithubIdentity {
  /** Numeric, immutable GitHub user id — the only identifier used for authorization. */
  id: number;
  login: string;
}

export interface GithubOAuthClient {
  /** Exchange an authorization code for an identity. The access token never leaves this method. */
  exchangeCodeForIdentity(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<GithubIdentity>;
}

export class GithubOAuthError extends Error {
  constructor(public readonly reason: "exchange_failed" | "identity_failed") {
    super(`github oauth: ${reason}`);
  }
}

export const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";
const API_VERSION = "2022-11-28";

export function buildAuthorizeUrl(p: { clientId: string; redirectUri: string; state: string; codeChallenge: string }): string {
  const url = new URL(GITHUB_AUTHORIZE_URL);
  url.searchParams.set("client_id", p.clientId);
  url.searchParams.set("redirect_uri", p.redirectUri);
  url.searchParams.set("state", p.state);
  url.searchParams.set("code_challenge", p.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("allow_signup", "false");
  // No `scope` parameter on purpose: identity only (no repo, no write scopes). See ADR-005 / CLAUDE.md §5.3.
  return url.toString();
}

type FetchFn = typeof fetch;

export class HttpGithubOAuthClient implements GithubOAuthClient {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchFn: FetchFn = fetch,
    private readonly timeoutMs = 10_000,
  ) {}

  async exchangeCodeForIdentity(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<GithubIdentity> {
    const tokenRes = await this.fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code: input.code,
        redirect_uri: input.redirectUri,
        code_verifier: input.codeVerifier,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(this.timeoutMs),
    }).catch(() => {
      throw new GithubOAuthError("exchange_failed");
    });
    // GitHub reports errors such as bad_verification_code in a JSON body with an `error` field;
    // whether the HTTP status is 200 is not stated in the docs, so both status and body are checked.
    const tokenBody = (await tokenRes.json().catch(() => null)) as { access_token?: unknown; error?: unknown } | null;
    if (!tokenRes.ok || !tokenBody || tokenBody.error || typeof tokenBody.access_token !== "string" || !tokenBody.access_token) {
      throw new GithubOAuthError("exchange_failed");
    }
    const accessToken = tokenBody.access_token;

    const userRes = await this.fetchFn(USER_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "aidevteam-control-center",
      },
      redirect: "error",
      signal: AbortSignal.timeout(this.timeoutMs),
    }).catch(() => {
      throw new GithubOAuthError("identity_failed");
    });
    const user = (await userRes.json().catch(() => null)) as { id?: unknown; login?: unknown } | null;
    if (!userRes.ok || !user || !Number.isSafeInteger(user.id) || (user.id as number) <= 0 || typeof user.login !== "string") {
      throw new GithubOAuthError("identity_failed");
    }
    // The access token is intentionally dropped here: it is not stored or returned (ADR-005).
    return { id: user.id as number, login: user.login.slice(0, 39) };
  }
}
