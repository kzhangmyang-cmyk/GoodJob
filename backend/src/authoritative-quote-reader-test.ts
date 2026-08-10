import assert from "node:assert/strict";
import test from "node:test";
import {
  approvalFixture,
  managerDecisionContext,
  workspaceContextFixture
} from "./growth-quote-test-fixtures.js";

test("authority history is reduced by revision and terminal decisions clear current", async () => {
  const state = approvalFixture();
  await state.service.approve(managerDecisionContext(), state.formalVersion.id,
    { reason: "同意" });
  const cutoff = await state.cutoff("2026-08-10T00:00:00.000Z");
  const current = await state.dealReader.getAt(
    workspaceContextFixture("manager"), "deal-1", cutoff
  );
  assert.equal(current?.quoteVersionId, state.formalVersion.id);
  assert.equal(current?.authorityRevision, 2);
});

test("as-of approval and version evidence preserve frozen owner and values", async () => {
  const state = approvalFixture();
  const context = workspaceContextFixture("manager");
  const cutoff = await state.cutoff("2026-08-10T00:00:00.000Z");
  const pending = await state.approvalReader.listPendingAsOf(context, {
    cutoff,
    limit: 100
  });
  assert.deepEqual(pending.map((row) => row.quoteVersionId), [
    state.formalVersion.id
  ]);
  assert.equal(pending[0]?.salesOwnerActorId, "sales-a");
  assert.equal(pending[0]?.closeProbabilityBps, 4_321);

  const evidence = await state.versionReader.getAt(
    context,
    state.formalVersion.id,
    cutoff
  );
  assert.equal(evidence?.versionKind, "formal");
  assert.equal(evidence?.sourceDraftVersionId, state.draftVersion.id);
  assert.equal(evidence?.commercialBindingEvidence.dealId, "deal-1");
  assert.equal(Object.isFrozen(evidence?.commercialBindingEvidence), true);
});

test("token workspace mismatch fails closed", async () => {
  const state = approvalFixture();
  const cutoff = await state.cutoff("2026-08-10T00:00:00.000Z");
  await assert.rejects(
    state.versionReader.getAt(state.otherWorkspace, state.formalVersion.id,
      cutoff),
    (error: unknown) => (error as { code?: string }).code
      === "sealed_cutoff_workspace_mismatch"
  );
});
