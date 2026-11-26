import { describe, expect, it } from "vitest";
import { buildAuthorizeUrl, GithubOAuthError, HttpGithubOAuthClient } from "../../src/auth/github-client";
import { pkceChallenge } from "../../src/crypto";

const FAKE_TOKEN = "gho_FAKEFAKEFAKEFAKEFAKEFAKE0000000000";

function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = responses.shift();
    if (!r) throw new Error("unexpected call");
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fn, calls };
}

describe("buildAuthorizeUrl", () => {
  const url = new URL(buildAuthorizeUrl({ clientId: "Iv1.abc12345", redirectUri: "https://cc.example.com/auth/github/callback", state: "s".repeat(43), codeChallenge: "c".repeat(43) }));

  it("targets github.com authorize with PKCE S256 and state", () => {
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toHaveLength(43);
    expect(url.searchParams.get("state")).toHaveLength(43);
    expect(url.searchParams.get("allow_signup")).toBe("false");
  });

  it("requests no scope at all (identity only, never repo/write)", () => {
    expect(url.searchParams.has("scope")).toBe(false);
  });
});

describe("pkceChallenge (S256 = BASE64URL(SHA256(verifier)), RFC 7636 §4.2)", () => {
  it("matches a value computed independently with Python hashlib + urlsafe_b64encode", () => {
    // python3 -c "import hashlib,base64;print(base64.urlsafe_b64encode(hashlib.sha256(b'dBjftJeZ4CVP-mJ92K27uhbUJU1p1r_wW1gFWFOEjXk').digest()).rstrip(b'=').decode())"
    expect(pkceChallenge("dBjftJeZ4CVP-mJ92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("ngF5GsXcbwljx6u133FFr3Xht9xooA_DuaX_3QwODtc");
  });

  it("is 43 base64url characters without padding (as GitHub requires)", () => {
    expect(pkceChallenge("x".repeat(43))).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("HttpGithubOAuthClient", () => {
  const input = { code: "code123", codeVerifier: "v".repeat(43), redirectUri: "https://cc.example.com/auth/github/callback" };

  it("exchanges the code with the verifier, then reads the numeric id", async () => {
    const { fn, calls } = fakeFetch([
      { status: 200, body: { access_token: FAKE_TOKEN, token_type: "bearer", scope: "" } },
      { status: 200, body: { id: 900000001, login: "test-user-01", email: "should-not-be-used@example.com" } },
    ]);
    const identity = await new HttpGithubOAuthClient("Iv1.abc12345", "fake-secret", fn).exchangeCodeForIdentity(input);
    expect(identity).toEqual({ id: 900000001, login: "test-user-01" });
    expect(calls[0]!.url).toBe("https://github.com/login/oauth/access_token");
    expect(calls[0]!.init.method).toBe("POST");
    const body = new URLSearchParams(String(calls[0]!.init.body));
    expect(body.get("code_verifier")).toBe(input.codeVerifier);
    expect(body.get("redirect_uri")).toBe(input.redirectUri);
    expect(calls[1]!.url).toBe("https://api.github.com/user");
    expect((calls[1]!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${FAKE_TOKEN}`);
  });

  it("does not return the access token", async () => {
    const { fn } = fakeFetch([
      { status: 200, body: { access_token: FAKE_TOKEN } },
      { status: 200, body: { id: 900000001, login: "test-user-01" } },
    ]);
    const identity = await new HttpGithubOAuthClient("Iv1.abc12345", "fake-secret", fn).exchangeCodeForIdentity(input);
    expect(JSON.stringify(identity)).not.toContain(FAKE_TOKEN);
  });

  it("fails on an error body even with HTTP 200 (e.g. bad_verification_code)", async () => {
    const { fn } = fakeFetch([{ status: 200, body: { error: "bad_verification_code", error_description: "The code passed is incorrect or expired." } }]);
    await expect(new HttpGithubOAuthClient("Iv1.abc12345", "fake-secret", fn).exchangeCodeForIdentity(input)).rejects.toThrow(GithubOAuthError);
  });

  it("fails when /user does not return a positive numeric id", async () => {
    const { fn } = fakeFetch([
      { status: 200, body: { access_token: FAKE_TOKEN } },
      { status: 200, body: { id: "900000001", login: "test-user-01" } },
    ]);
    await expect(new HttpGithubOAuthClient("Iv1.abc12345", "fake-secret", fn).exchangeCodeForIdentity(input)).rejects.toThrow(/identity_failed/);
  });

  it("fails closed on network errors", async () => {
    const fn = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    await expect(new HttpGithubOAuthClient("Iv1.abc12345", "fake-secret", fn).exchangeCodeForIdentity(input)).rejects.toThrow(/exchange_failed/);
  });
});
