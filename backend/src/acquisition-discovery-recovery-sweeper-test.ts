import assert from "node:assert/strict";
import test from "node:test";
import {
  AcquisitionDiscoveryOperationService,
  InMemoryAcquisitionDiscoveryOperationRepository
} from "./acquisition-discovery-operations.js";
import {
  AcquisitionDiscoveryRecoverySweeper
} from "./acquisition-discovery-recovery-sweeper.js";

const MASTER_SECRET =
  "discovery-recovery-test-master-secret-at-least-32-bytes";
const SCOPE = {
  ownerId: "owner-recovery",
  teamId: "team-recovery",
  actorId: "actor-recovery"
};

function fixture() {
  let now = Date.parse("2026-07-24T08:00:00.000Z");
  const repository =
    new InMemoryAcquisitionDiscoveryOperationRepository();
  const service = new AcquisitionDiscoveryOperationService({
    repository,
    evidence: {
      async appendEvidence(scope, input) {
        return {
          ...input,
          id: "evidence-recovery",
          ownerId: scope.ownerId,
          teamId: scope.teamId,
          supersedesEvidenceId: input.supersedesEvidenceId ?? null,
          fetchedAt: new Date(now).toISOString()
        };
      }
    },
    fetcher: {
      async fetch(sourceUrl) {
        return {
          finalUrl: sourceUrl,
          status: "access_restricted",
          accessStatus: "access_restricted",
          httpStatus: 403,
          contentType: "text/html",
          title: "",
          text: "",
          rawArtifactHash: `sha256:${"a".repeat(64)}`,
          contentHash: `sha256:${"b".repeat(64)}`
        };
      }
    },
    masterSecret: MASTER_SECRET,
    workerId: "recovery-worker",
    leaseTokenFactory: () => "recovery-lease",
    now: () => new Date(now).toISOString()
  });
  return {
    repository,
    service,
    now: () => now,
    advance(ms: number) {
      now += ms;
    }
  };
}

test("startup recovery executes queued work and preserves access-restricted truth", async () => {
  const state = fixture();
  const queued = await state.service.createContentFetchOperation(
    SCOPE,
    {
      sourceUrl: "https://example.com/recovery-restricted",
      subjectChannel: "organization"
    },
    "recovery-startup-key"
  );
  const queuedImport = await state.service.createImportOperation(
    SCOPE,
    {
      fileName: "startup-recovery.csv",
      mediaType: "text/csv",
      content: new TextEncoder().encode(
        "标题,摘要\r\n恢复导入,应用启动后恢复此前排队的客户授权导入"
      ),
      subjectChannel: "organization",
      columnMapping: {
        sourceTitle: "标题",
        sourceSnippet: "摘要"
      }
    },
    "recovery-startup-import-key"
  );
  const dispatched: string[] = [];
  const sweeper = new AcquisitionDiscoveryRecoverySweeper({
    service: state.service,
    dispatchContentFetchOperation: async (scope, operationId) => {
      dispatched.push(`fetch:${operationId}`);
      await state.service.executeContentFetchOperation(scope, operationId);
    },
    async dispatchImportOperation(scope, operationId) {
      dispatched.push(`import:${operationId}`);
      await state.service.executeImportOperation(scope, operationId);
    },
    intervalMs: 60_000,
    staleRunningMs: 10 * 60_000,
    nowMs: state.now
  });

  await sweeper.start();
  const completed = await state.service.getContentFetchOperation(
    SCOPE,
    queued.id
  );
  const completedImport = await state.service.getImportOperation(
    SCOPE,
    queuedImport.id
  );

  assert.deepEqual(dispatched.sort(), [
    `fetch:${queued.id}`,
    `import:${queuedImport.id}`
  ].sort());
  assert.equal(completed.status, "access_restricted");
  assert.equal(completed.accessStatus, "access_restricted");
  assert.equal(completedImport.status, "succeeded");
  assert.equal(completedImport.acceptedRowCount, 1);
  await sweeper.close();
});

test("periodic recovery ignores terminal operations and dispatches newly queued work once", async () => {
  const state = fixture();
  const callbacks: Array<() => void> = [];
  const dispatched: string[] = [];
  const sweeper = new AcquisitionDiscoveryRecoverySweeper({
    service: state.service,
    dispatchContentFetchOperation: async (scope, operationId) => {
      dispatched.push(operationId);
      await state.service.executeContentFetchOperation(scope, operationId);
    },
    async dispatchImportOperation() {
      throw new Error("unexpected import");
    },
    intervalMs: 60_000,
    nowMs: state.now,
    setTimer(callback) {
      callbacks.push(callback);
      return { unref() {} };
    },
    clearTimer() {}
  });
  await sweeper.start();
  const queued = await state.service.createContentFetchOperation(
    SCOPE,
    {
      sourceUrl: "https://example.com/recovery-periodic",
      subjectChannel: "organization"
    },
    "recovery-periodic-key"
  );

  callbacks.shift()!();
  await sweeper.whenIdle();
  assert.deepEqual(dispatched, [queued.id]);

  state.advance(60_000);
  callbacks.shift()!();
  await sweeper.whenIdle();
  assert.deepEqual(
    dispatched,
    [queued.id],
    "terminal operations must not be dispatched again"
  );
  await sweeper.close();
});
