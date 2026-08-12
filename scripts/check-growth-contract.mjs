import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CONTRACT_NAME = "growth-advisor-quote-roi";

function pinnedDirectory() {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "contracts",
    "pinned"
  );
}

export async function verifyPinnedGrowthContractAt(directory) {
  const openApiPath = path.join(
    directory, `${CONTRACT_NAME}.openapi.json`
  );
  const manifestPath = path.join(
    directory, `${CONTRACT_NAME}.manifest.json`
  );
  const [bytes, manifestText] = await Promise.all([
    readFile(openApiPath),
    readFile(manifestPath, "utf8")
  ]);
  const manifest = JSON.parse(manifestText);
  const actual = `sha256:${createHash("sha256")
    .update(bytes).digest("hex")}`;
  if (actual !== manifest.contractHash) {
    throw new Error("Pinned growth contract hash mismatch");
  }
  return manifest;
}

export async function verifyPinnedGrowthContract() {
  return verifyPinnedGrowthContractAt(pinnedDirectory());
}

function isMain(metaUrl) {
  const entry = process.argv[1];
  return entry !== undefined
    && pathToFileURL(path.resolve(entry)).href === metaUrl;
}

async function main(argv) {
  if (argv.length !== 0) throw new Error("Usage: check-growth-contract.mjs");
  await verifyPinnedGrowthContract();
}

if (isMain(import.meta.url)) await main(process.argv.slice(2));
