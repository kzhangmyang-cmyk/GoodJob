import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import SwaggerParser from "@apidevtools/swagger-parser";
import YAML from "yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemasDirectory = path.join(root, "json-schema");

export async function loadSchemaRegistry() {
  const filenames = (await readdir(schemasDirectory))
    .filter((filename) => filename.endsWith(".v1.schema.json"))
    .sort();
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const schemas = await Promise.all(filenames.map(async (filename) => ({
    filename,
    schema: JSON.parse(await readFile(path.join(schemasDirectory, filename), "utf8"))
  })));
  for (const { schema } of schemas) ajv.addSchema(schema);
  const names = new Set();
  const ids = new Set();
  const validators = new Map();
  for (const { filename, schema } of schemas) {
    const name = filename.replace(".v1.schema.json", "");
    names.add(name);
    ids.add(schema.$id);
    validators.set(name, ajv.getSchema(schema.$id));
  }
  return { names, ids, validators };
}

export async function loadContractHarness() {
  const registry = await loadSchemaRegistry();
  return {
    validateCase(name, value) {
      const validate = registry.validators.get(name);
      if (!validate) throw new Error(`Unknown schema: ${name}`);
      return { valid: validate(value), errors: validate.errors };
    },
    async loadExamples() {
      const readExample = async (filename) => JSON.parse(await readFile(path.join(root, "examples", filename), "utf8"));
      return {
        organization: await readExample("organization-flow.v1.json"),
        individual: await readExample("individual-flow.v1.json"),
        search: await readExample("search-smoke-query.v1.json")
      };
    }
  };
}

export async function loadOpenApi() {
  const source = await readFile(path.join(root, "openapi", "ai-acquisition.v1.yaml"), "utf8");
  const document = YAML.parse(source, { merge: true });
  return SwaggerParser.validate(document);
}
