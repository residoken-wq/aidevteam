import type { AppConfig } from "../src/config";

/** Fake configuration for tests. No real credentials. */
export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 3001,
    databaseUrl: "postgres://unused@127.0.0.1:1/unused_test",
    publicBaseUrl: "https://cc.example.com",
    github: {
      clientId: "Iv1.testclientid",
      clientSecret: "fake-client-secret-for-tests-only",
      callbackUrl: "https://cc.example.com/auth/github/callback",
    },
    sessionTtlMinutes: 60,
    mockWorkerEnabled: false,
    trustedProxies: [],
    ...overrides,
  };
}
