import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");

const COMPOSE_FILE = path.join(ROOT, "dev", "compose.yaml");
const DEV_ENV_FILE = path.join(ROOT, "dev", "dev.env");
const DIRECT_SECRET_REF = path.join(ROOT, "packages", "contracts", "dist", "secret-ref.js");
const CONTRACTS_SECRET_REF = path.join(ROOT, "packages", "db", "node_modules", "@aidevteam", "contracts", "dist", "secret-ref.js");

// Standard secret patterns to forbid in committed env files
const FORBIDDEN_SECRET_REGEX = /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|(?:AKIA|ASIA)[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;

export function extractPorts(composeText) {
  const lines = composeText.split(/\r?\n/);
  const ports = [];
  let inPorts = false;
  let indent = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const m = line.match(/^(\s*)ports:\s*$/);
    if (m) {
      inPorts = true;
      indent = m[1].length;
      continue;
    }

    if (inPorts) {
      const lineIndent = line.match(/^(\s*)/)[1].length;
      if (lineIndent <= indent && !trimmed.startsWith("-")) {
        inPorts = false;
        continue;
      }
      const itemMatch = trimmed.match(/^-\s*["']?([^"']+)["']?$/);
      if (itemMatch) {
        ports.push(itemMatch[1].trim());
      }
    }
  }
  return ports;
}

export function validateComposePorts(composeText) {
  const ports = extractPorts(composeText);
  assert.ok(ports.length > 0, "dev/compose.yaml must define at least one port mapping");
  for (const port of ports) {
    if (port.startsWith("0.0.0.0:")) {
      throw new Error(`Insecure port mapping: "${port}". Binding to 0.0.0.0 is strictly prohibited.`);
    }
    if (!port.startsWith("127.0.0.1:")) {
      throw new Error(`Forbidden port mapping: "${port}". All ports must be explicitly bound to 127.0.0.1: (loopback only).`);
    }
  }
  return ports;
}

export function validateComposeSecurity(composeText) {
  if (composeText.includes("docker.sock")) {
    throw new Error("Security violation: docker.sock must not be referenced or mounted anywhere in dev/compose.yaml");
  }
  if (/privileged:\s*true/i.test(composeText)) {
    throw new Error("Security violation: privileged containers are strictly prohibited in dev/compose.yaml");
  }
  assert.match(composeText, /no-new-privileges:true/, "dev/compose.yaml must specify no-new-privileges:true");
  assert.match(composeText, /cap_drop:\s*\r?\n\s*-\s*ALL/, "dev/compose.yaml must drop ALL capabilities for app services");
}

export function validateComposeConfig(composeText) {
  assert.match(composeText, /^name:\s*aidevteam-dev\b/m, "dev/compose.yaml project name must be aidevteam-dev");
  const pinnedDigest = "postgres:16-bookworm@sha256:cd0e9518bda5f2ea667ff84d22795d089720c883f288e215d97ce57437e8ef37";
  assert.ok(composeText.includes(pinnedDigest), `dev/compose.yaml must pin PostgreSQL image to exact digest matching CI: ${pinnedDigest}`);
  assert.match(composeText, /name:\s*aidevteam-dev-pg\b/, "dev/compose.yaml must define named volume aidevteam-dev-pg");
  assert.match(composeText, /pg_isready -U postgres/, "dev/compose.yaml must include healthcheck using pg_isready");
  assert.match(composeText, /POSTGRES_HOST_AUTH_METHOD:\s*trust/, "dev/compose.yaml must configure trust auth for dev");
  assert.match(composeText, /DEV ONLY/, "dev/compose.yaml must include 'DEV ONLY' warning comment near trust auth");
}

export function parseEnvFile(envText) {
  const lines = envText.split(/\r?\n/);
  const entries = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      entries.push({ key, value });
    }
  }
  return entries;
}

export function validateDevEnv(envText, looksLikeSecretFn) {
  const entries = parseEnvFile(envText);
  assert.ok(entries.length > 0, "dev/dev.env must define environment variables");

  for (const { key, value } of entries) {
    if (FORBIDDEN_SECRET_REGEX.test(value)) {
      throw new Error(`Real secret pattern detected in dev.env for key ${key}: ${value}`);
    }
    if (looksLikeSecretFn && looksLikeSecretFn(value)) {
      throw new Error(`Value for key ${key} looks like a real secret: ${value}`);
    }
    if (key.toLowerCase().includes("secret")) {
      if (!value.toLowerCase().includes("fake")) {
        throw new Error(`Secret key "${key}" value "${value}" must contain "fake" to guarantee it cannot be a real secret`);
      }
    }
  }

  assert.ok(
    envText.includes("tests/e2e/run-local.sh"),
    "dev/dev.env must include comment explaining that real GitHub login is disabled and referencing tests/e2e/run-local.sh for fake sessions"
  );
}

describe("dev/compose.yaml static validation", () => {
  it("exists on disk", () => {
    assert.ok(fs.existsSync(COMPOSE_FILE), "dev/compose.yaml must exist");
  });

  it("binds all published ports exclusively to 127.0.0.1 (loopback)", () => {
    const content = fs.readFileSync(COMPOSE_FILE, "utf-8");
    const ports = validateComposePorts(content);
    assert.ok(ports.length >= 3, `Expected at least 3 published ports (postgres, api, web), got ${ports.length}`);
  });

  it("contains no docker.sock and no privileged: true, enforces hardening", () => {
    const content = fs.readFileSync(COMPOSE_FILE, "utf-8");
    validateComposeSecurity(content);
  });

  it("specifies correct project name, pinned postgres digest, and named volume", () => {
    const content = fs.readFileSync(COMPOSE_FILE, "utf-8");
    validateComposeConfig(content);
  });

  it("initdb directory contains valid SQL initialization", () => {
    const initSqlPath = path.join(ROOT, "dev", "initdb", "01-init.sql");
    assert.ok(fs.existsSync(initSqlPath), "dev/initdb/01-init.sql must exist");
    const sql = fs.readFileSync(initSqlPath, "utf-8");
    assert.match(sql, /CREATE DATABASE aidevteam_dev;/);
    assert.match(sql, /CREATE DATABASE aidevteam_test;/);
  });
});

describe("dev/dev.env static validation", async () => {
  let looksLikeSecretFn = null;
  try {
    const targetPath = fs.existsSync(DIRECT_SECRET_REF) ? DIRECT_SECRET_REF : CONTRACTS_SECRET_REF;
    const mod = await import(`file://${targetPath.replace(/\\/g, "/")}`);
    looksLikeSecretFn = mod.looksLikeSecret;
  } catch {
    // Fallback if contracts dist not loaded
  }

  it("exists on disk", () => {
    assert.ok(fs.existsSync(DEV_ENV_FILE), "dev/dev.env must exist");
  });

  it("contains only fake values and no real secrets", () => {
    const content = fs.readFileSync(DEV_ENV_FILE, "utf-8");
    validateDevEnv(content, looksLikeSecretFn);
  });
});

describe("mutation & validation robustness (AC-1 verification)", () => {
  it("rejects 0.0.0.0 port bindings", () => {
    const badYaml = `
services:
  postgres:
    ports:
      - "0.0.0.0:55433:5432"
`;
    assert.throws(
      () => validateComposePorts(badYaml),
      /Forbidden port mapping|Insecure port mapping/
    );
  });

  it("rejects un-prefixed port bindings", () => {
    const badYaml = `
services:
  postgres:
    ports:
      - "55433:5432"
`;
    assert.throws(
      () => validateComposePorts(badYaml),
      /Forbidden port mapping/
    );
  });

  it("rejects docker.sock reference", () => {
    const badYaml = `
services:
  api:
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
`;
    assert.throws(
      () => validateComposeSecurity(badYaml),
      /Security violation: docker\.sock/
    );
  });

  it("rejects privileged: true", () => {
    const badYaml = `
services:
  api:
    privileged: true
`;
    assert.throws(
      () => validateComposeSecurity(badYaml),
      /Security violation: privileged/
    );
  });

  it("rejects secret keys without 'fake' in value", () => {
    const badEnv = `
GITHUB_OAUTH_CLIENT_SECRET=some-production-secret-value
`;
    assert.throws(
      () => validateDevEnv(badEnv, null),
      /must contain "fake"/
    );
  });

  it("rejects real token patterns like GitHub PAT", () => {
    // Built at runtime so the literal never sits in the repo (secret scanners would flag it). FAKE value.
    const fakePat = "ghp_" + "FAKE0".repeat(7) + "0";
    const badEnv = `
GITHUB_TOKEN=${fakePat}
`;
    assert.throws(
      () => validateDevEnv(badEnv, null),
      /Real secret pattern detected/
    );
  });
});
