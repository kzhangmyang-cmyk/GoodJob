import test from "node:test";
import assert from "node:assert/strict";
import { loadContractHarness } from "./helpers.mjs";

test("personal evidence cannot omit provenance or masquerade as a company", async () => {
  const { validateCase } = await loadContractHarness();
  assert.equal(validateCase("discovery-evidence", {
    id: "ev_invalid", targetType: "individual_signal"
  }).valid, false);
  assert.equal(validateCase("individual-demand-signal", {
    id: "person_invalid", company: "个人用户"
  }).valid, false);
});

test("outcome feedback rejects untyped live parties and legacy individual parties", async () => {
  const { validateCase } = await loadContractHarness();
  const live = {
    id: "outcome_live_invalid", ownerId: "owner", teamId: "team", leadId: null, customerId: null,
    eventType: "validated", occurredAt: "2026-07-23T00:00:00.000Z", amount: null,
    reasonCode: null, reasonText: null, idempotencyKey: "key", createdBy: "user",
    createdAt: "2026-07-23T00:00:00.000Z", recordKind: "live", partyRef: { arbitrary: true },
    candidateId: "candidate", attribution: {
      runId: "run", evidenceIds: [], providerIds: [], queryIds: [], strategyVersion: "v1",
      qualificationDecisionId: "decision", decisionVersion: "v1", decisionSnapshotHash: "hash",
      decisionEngine: "rules", ruleVersion: "v1", modelProvider: null, model: null, promptVersion: null
    }
  };
  const legacy = {
    ...live, id: "outcome_legacy_invalid", recordKind: "legacy_migrated", legacySourceId: "legacy-1",
    partyRef: { partyType: "individual", individualPartyId: "party", demandSignalId: "signal" },
    candidateId: null, attribution: {
      ...live.attribution, runId: null, strategyVersion: null, qualificationDecisionId: null,
      decisionVersion: null, decisionSnapshotHash: null, decisionEngine: null, ruleVersion: null
    }, migrationWarnings: []
  };
  assert.equal(validateCase("outcome-feedback", live).valid, false);
  assert.equal(validateCase("outcome-feedback", legacy).valid, false);
});

test("rules decisions cannot claim model metadata and inference cards require support", async () => {
  const { validateCase } = await loadContractHarness();
  const decision = {
    decisionEngine: "rules", grade: "B", score: 60, recommendedAction: "nurture",
    evidence: [{ evidenceId: "ev_1" }], positiveSignals: [], negativeSignals: [], reasons: ["rule"],
    confidence: 0.7, ruleVersion: "rules-v1", promptVersion: "prompt-v1", modelProvider: "openai", model: "gpt"
  };
  const card = {
    id: "card_1", candidateId: "candidate_1", partyType: "organization",
    sections: [{ label: "Pain point", kind: "inference", content: "Likely needs a CRM." }],
    evidenceIds: ["ev_1"], confidence: 0.8, modelProvider: "openai", model: "gpt", promptVersion: "v1",
    createdAt: "2026-07-23T00:00:00.000Z"
  };
  assert.equal(validateCase("qualification-decision", decision).valid, false);
  assert.equal(validateCase("battle-card", card).valid, false);
});

test("contract examples validate as complete organization and individual flows", async () => {
  const { loadExamples, validateCase } = await loadContractHarness();
  const examples = await loadExamples();
  for (const record of examples.organization.records) {
    assert.equal(validateCase(record.schema, record.value).valid, true, record.schema);
  }
  for (const record of examples.individual.records) {
    assert.equal(validateCase(record.schema, record.value).valid, true, record.schema);
  }
  assert.equal(examples.organization.records.length > 0, true);
  assert.equal(examples.individual.records.length > 0, true);
  assert.equal(examples.search.queryText.length > 0, true);
});
