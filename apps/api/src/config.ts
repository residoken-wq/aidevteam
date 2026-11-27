import { z } from "zod";

/** Parse PORT from the environment. Fails closed on invalid values instead of guessing. */
export function parsePort(raw: string | undefined, fallback = 3001): number {
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d{1,5}$/.test(raw)) throw new Error("PORT must be an integer between 1 and 65535");
  const port = Number(raw);
  if (port < 1 || port > 65535) throw new Error("PORT must be an integer between 1 and 65535");
  return port;
}

const httpsOrigin = z
  .string()
  .url()
  .refine((v) => {
    const u = new URL(v);
    return (u.protocol === "https:" || u.hostname === "localhost" || u.hostname === "127.0.0.1") && u.pathname === "/" && !u.search && !u.hash;
  }, "must be an https origin without path, e.g. https://cc.example.com");

const EnvSchema = z.object({
  PORT: z.string().optional(),
  MOCK_WORKER_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  PUBLIC_BASE_URL: httpsOrigin,
  GITHUB_OAUTH_CLIENT_ID: z.string().regex(/^[A-Za-z0-9._-]{8,64}$/, "GITHUB_OAUTH_CLIENT_ID looks invalid"),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().min(20, "GITHUB_OAUTH_CLIENT_SECRET is required"),
  SESSION_TTL_MINUTES: z
    .string()
    .regex(/^\d+$/)
    .optional()
    .transform((v) => (v === undefined ? 480 : Number(v)))
    .refine((n) => n >= 5 && n <= 7 * 24 * 60, "SESSION_TTL_MINUTES must be between 5 and 10080"),
  TRUSTED_PROXY_IPS: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []))
    .refine((ips) => ips.every((ip) => /^[0-9a-fA-F.:/]+$/.test(ip)), "TRUSTED_PROXY_IPS must be a comma-separated list of IPs/CIDRs"),
});

export interface AppConfig {
  port: number;
  mockWorkerEnabled: boolean;
  runnerTimeoutMs?: number;
  databaseUrl: string;
  /** Public origin users see (behind the NPM proxy), e.g. https://cc.example.com */
  publicBaseUrl: string;
  github: {
    clientId: string;
    clientSecret: string;
    /** Must equal the callback URL registered on the GitHub OAuth App. */
    callbackUrl: string;
  };
  sessionTtlMinutes: number;
  /** Express "trust proxy" list. Only these hops may set X-Forwarded-* (e.g. NPM 192.168.250.10). */
  trustedProxies: string[];
}

/**
 * Load configuration from the environment and fail closed on anything missing or malformed.
 * Error messages name the variable but never echo its value.
 */
export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`invalid configuration: ${problems}`);
  }
  const e = parsed.data;
  const origin = new URL(e.PUBLIC_BASE_URL).origin;
  return {
    port: parsePort(e.PORT),
    mockWorkerEnabled: e.MOCK_WORKER_ENABLED ?? false,
    databaseUrl: e.DATABASE_URL,
    publicBaseUrl: origin,
    github: {
      clientId: e.GITHUB_OAUTH_CLIENT_ID,
      clientSecret: e.GITHUB_OAUTH_CLIENT_SECRET,
      callbackUrl: `${origin}/auth/github/callback`,
    },
    sessionTtlMinutes: e.SESSION_TTL_MINUTES,
    trustedProxies: e.TRUSTED_PROXY_IPS,
  };
}
