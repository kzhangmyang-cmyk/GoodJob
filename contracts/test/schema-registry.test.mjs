import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { loadSchemaRegistry } from "./helpers.mjs";

const expected = [
  "api-error", "paged-result", "async-operation", "model-provider",
  "model-connection", "model-capability", "model-call-record",
  "discovery-provider", "provider-connection", "content-fetch-operation",
  "import-operation", "acquisition-plan", "acquisition-run",
  "acquisition-run-presentation",
  "acquisition-operation-shard", "discovery-evidence", "party-ref",
  "organization-candidate", "individual-demand-signal",
  "qualification-decision", "battle-card", "review-event",
  "outcome-feedback", "financial-value-decision", "copilot-session",
  "copilot-message", "copilot-task"
];

test("ai-acquisition.v1 exposes the complete unique schema registry", async () => {
  const registry = await loadSchemaRegistry();
  assert.deepEqual([...registry.names].sort(), [...expected].sort());
  assert.equal(registry.ids.size, expected.length);
  for (const validate of registry.validators.values()) {
    assert.equal(typeof validate, "function");
  }
});

test("battle-card.v2 enforces evidence-bound structured intelligence", async () => {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    ".."
  );
  const schema = JSON.parse(await readFile(
    path.join(root, "json-schema", "battle-card.v2.schema.json"),
    "utf8"
  ));
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true
  });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const claim = {
    kind: "fact",
    text: "客户官网公开发布了采购需求。",
    evidenceIds: ["evidence-1"],
    confidence: 1
  };
  const valid = {
    id: "battle-card-2",
    candidateId: "candidate-1",
    partyType: "organization",
    schemaVersion: "battle-card.v2",
    intelligence: {
      accountOverview: [claim],
      needAssessment: [claim],
      supplierHypotheses: [{
        kind: "unknown",
        text: "没有足够证据确认现有供应商。",
        evidenceIds: [],
        confidence: null
      }],
      buyingCommittee: [{
        role: "业务负责人",
        priority: 1,
        influence: "decision_maker",
        concerns: ["投入产出"],
        claim
      }],
      procurementPreferences: [{
        kind: "inference",
        text: "采购更关注可量化效果。",
        evidenceIds: ["evidence-1"],
        confidence: 0.72
      }],
      connectionStrategies: [{
        channel: "email",
        targetRole: "业务负责人",
        rationale: claim,
        openingDraft: "建议人工审核后，以公开需求为背景提供诊断。"
      }],
      roleSpecificOpeners: [{
        role: "业务负责人",
        channel: "email",
        text: "看到贵司公开的采购需求，我们整理了一页诊断供参考。"
      }],
      doNotActions: ["不要在没有证据时声称了解现有供应商"],
      financialSummary: {
        decisionId: "financial-1",
        decisionVersion: "financial-v1",
        grade: "A",
        score: 82,
        currency: "CNY",
        expectedRevenueMinor: 1_000_000,
        expectedGrossProfitMinor: 600_000,
        expectedContributionMinor: 500_000,
        factors: {
          profitability: 80,
          cashFlow: 70,
          creditQuality: 75,
          repeatPotential: 60,
          referralPotential: 40,
          closeProbability: 65
        }
      }
    },
    evidenceIds: ["evidence-1"],
    confidence: 0.8,
    modelProvider: "openai",
    model: "gpt-5",
    promptVersion: "acquisition-model-prompt-bundle.v5",
    createdAt: "2026-07-26T00:00:00.000Z"
  };

  assert.equal(validate(valid), true, JSON.stringify(validate.errors));
  for (const invalidClaim of [{
    ...claim,
    evidenceIds: []
  }, {
    kind: "inference",
    text: "没有置信度的推断",
    evidenceIds: ["evidence-1"],
    confidence: null
  }, {
    kind: "unknown",
    text: "未知项不得引用证据",
    evidenceIds: ["evidence-1"],
    confidence: null
  }]) {
    assert.equal(validate({
      ...valid,
      intelligence: {
        ...valid.intelligence,
        accountOverview: [invalidClaim]
      }
    }), false);
  }
});

test("financial values expose only the current closed public projection", async () => {
  const registry = await loadSchemaRegistry();
  const schema = registry.schemaDocuments.get("financial-value-decision");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, [
    "id",
    "candidateId",
    "qualificationDecisionId",
    "version",
    "grade",
    "score",
    "currency",
    "expectedRevenueMinor",
    "expectedGrossProfitMinor",
    "expectedContributionMinor",
    "factors",
    "createdAt"
  ]);
  assert.deepEqual(Object.keys(schema.properties), schema.required);
  for (const name of [
    "expectedRevenueMinor",
    "expectedGrossProfitMinor",
    "expectedContributionMinor"
  ]) {
    assert.equal(schema.properties[name].type, "integer");
  }
  assert.deepEqual(schema.properties.factors.required, [
    "profitability",
    "cashFlow",
    "creditQuality",
    "repeatPotential",
    "referralPotential",
    "closeProbability"
  ]);
  assert.equal(schema.properties.factors.additionalProperties, false);
});

test("copilot messages preserve identity, session, content, and linkage", async () => {
  const registry = await loadSchemaRegistry();
  const schema = registry.schemaDocuments.get("copilot-message");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, [
    "id",
    "sessionId",
    "sequence",
    "message",
    "createdAt"
  ]);
  const variants = schema.properties.message.oneOf;
  assert.deepEqual(
    variants.map((variant) => variant.properties.role.const),
    ["user", "assistant", "toolResult"]
  );
  for (const variant of variants) {
    assert.equal(variant.additionalProperties, false);
    assert.ok(variant.required.includes("role"));
    assert.ok(variant.required.includes("content"));
    assert.ok(variant.required.includes("timestamp"));
  }
  const toolResult = variants.find(
    (variant) => variant.properties.role.const === "toolResult"
  );
  assert.ok(toolResult.required.includes("toolCallId"));
  assert.equal(schema.properties.taskId, undefined);
});
