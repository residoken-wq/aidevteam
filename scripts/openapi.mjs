#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import buildOpenApiDocument from @aidevteam/contracts
let buildOpenApiDocument;
try {
  const contracts = await import("@aidevteam/contracts");
  buildOpenApiDocument = contracts.buildOpenApiDocument;
} catch {
  const contractsPath = resolve(__dirname, "../packages/contracts/dist/index.js");
  const contracts = await import(`file://${contractsPath.replace(/\\/g, "/")}`);
  buildOpenApiDocument = contracts.buildOpenApiDocument;
}

if (!buildOpenApiDocument) {
  console.error("Failed to load buildOpenApiDocument from @aidevteam/contracts.");
  process.exit(1);
}

const doc = buildOpenApiDocument();
const expectedContent = JSON.stringify(doc, null, 2) + "\n";
const targetPath = resolve(__dirname, "../docs/api/openapi.json");

const isCheck = process.argv.includes("--check");

if (isCheck) {
  if (!existsSync(targetPath)) {
    console.error(`docs/api/openapi.json does not exist. Run 'pnpm openapi' to generate it.`);
    process.exit(1);
  }

  const existingContent = readFileSync(targetPath, "utf-8");

  if (existingContent === expectedContent) {
    process.stdout.write("OpenAPI spec is up-to-date.\n");
    process.exit(0);
  }

  // Find mismatches in paths
  let existingDoc;
  try {
    existingDoc = JSON.parse(existingContent);
  } catch {
    console.error("docs/api/openapi.json is not valid JSON.");
    process.exit(1);
  }

  const existingPaths = new Set(Object.keys(existingDoc.paths || {}));
  const generatedPaths = new Set(Object.keys(doc.paths || {}));

  const missingPaths = [...generatedPaths].filter((p) => !existingPaths.has(p));
  const extraPaths = [...existingPaths].filter((p) => !generatedPaths.has(p));
  const changedPaths = [...generatedPaths].filter(
    (p) => existingPaths.has(p) && JSON.stringify(existingDoc.paths[p]) !== JSON.stringify(doc.paths[p]),
  );

  console.error("OpenAPI spec mismatch detected:");
  if (missingPaths.length > 0) {
    console.error("  Missing paths in openapi.json:", missingPaths.join(", "));
  }
  if (extraPaths.length > 0) {
    console.error("  Extra paths in openapi.json:", extraPaths.join(", "));
  }
  if (changedPaths.length > 0) {
    console.error("  Modified paths:", changedPaths.join(", "));
  }
  if (missingPaths.length === 0 && extraPaths.length === 0 && changedPaths.length === 0) {
    console.error("  Differences found in non-path metadata or schemas.");
  }
  process.exit(1);
} else {
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, expectedContent, "utf-8");
  process.stdout.write(`Wrote OpenAPI spec to ${targetPath}\n`);
}
