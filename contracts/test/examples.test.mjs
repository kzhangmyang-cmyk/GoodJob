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
