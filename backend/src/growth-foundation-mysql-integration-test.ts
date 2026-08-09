import assert from "node:assert/strict";
import { test } from "node:test";
import { capabilitiesForHumanRole } from "./growth-capabilities.js";
import { growthInstantMilliseconds } from "./growth-as-of.js";
import { withGrowthFoundationMysqlTestDatabase } from "./growth-foundation-mysql-test-support.js";
import { MysqlGrowthTemporalTransaction, growthMysqlInstant } from "./growth-temporal-barrier-mysql-repository.js";
import type { ActiveWorkspaceContext } from "./growth-workspace-context.js";

function workspace(workspaceId: string): ActiveWorkspaceContext {
  return Object.freeze({
    workspaceId,
    kind: "team",
    actorId: "mysql-user",
    role: "admin",
    teamId: workspaceId,
    capabilities: capabilitiesForHumanRole("admin"),
    capabilityRegistryVersion: "growth-capabilities.v1"
  });
}

test("real MySQL foundation globally fences writes and preserves settings history", async () => {
  await withGrowthFoundationMysqlTestDatabase(async ({
    pool,
    connectionA,
    connectionB,
    barrier,
    settings
  }) => {
    await pool.query(
      `CREATE TABLE growth_foundation_test_events (
        workspace_id VARCHAR(191) NOT NULL,
        stream_id VARCHAR(191) NOT NULL,
        recorded_at DATETIME(3) NOT NULL,
        PRIMARY KEY (workspace_id, stream_id)
      ) ENGINE=InnoDB`
    );
    await connectionA.beginTransaction();
    const priorStamp = await barrier.allocateAppend(
      new MysqlGrowthTemporalTransaction(connectionA),
      "workspace-a"
    );
    await connectionA.query(
      `INSERT INTO growth_foundation_test_events (
        workspace_id, stream_id, recorded_at
      ) VALUES (?, ?, ?)`,
      [
        "workspace-a",
        "prior-stream",
        priorStamp.recordedAt.slice(0, 23).replace("T", " ")
      ]
    );
    const effectiveAsOf = new Date(
      growthInstantMilliseconds(priorStamp.recordedAt) + 100
    ).toISOString();
    const sealing = barrier.sealReadCutoff(
      workspace("workspace-a"),
      effectiveAsOf
    );
    let settled = false;
    void sealing.then(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(settled, false, "seal must wait for the earlier row-lock owner");
    await connectionA.commit();
    const token = await sealing;
    const readAtCutoff = async () => {
      const [rows] = await connectionB.query(
        `SELECT stream_id
         FROM growth_foundation_test_events
         WHERE workspace_id = ? AND recorded_at <= ?
         ORDER BY stream_id`,
        [
          "workspace-a",
          token.effectiveAsOf.slice(0, 23).replace("T", " ")
        ]
      );
      return (rows as Array<Record<string, unknown>>)
        .map((row) => String(row.stream_id));
    };
    const beforeLaterAppend = await readAtCutoff();
    assert.deepEqual(beforeLaterAppend, ["prior-stream"]);

    await connectionA.beginTransaction();
    const laterStamp = await barrier.allocateAppend(
      new MysqlGrowthTemporalTransaction(connectionA),
      "workspace-a"
    );
    assert.ok(laterStamp.recordedAt > token.effectiveAsOf);
    await connectionA.query(
      `INSERT INTO growth_foundation_test_events (
        workspace_id, stream_id, recorded_at
      ) VALUES (?, ?, ?)`,
      [
        "workspace-a",
        "later-new-stream",
        laterStamp.recordedAt.slice(0, 23).replace("T", " ")
      ]
    );
    await connectionA.commit();
    assert.deepEqual(await readAtCutoff(), beforeLaterAppend);

    await settings.appendTrustedSettingsEvent("workspace-a", {
      timeZone: "Asia/Shanghai",
      revision: "settings-1"
    });
    const first = await settings.get(workspace("workspace-a"));
    const historical = await barrier.sealReadCutoff(
      workspace("workspace-a"),
      first.recordedAt
    );
    await settings.appendTrustedSettingsEvent("workspace-a", {
      timeZone: "Asia/Hong_Kong",
      revision: "settings-2"
    });
    assert.equal(
      (await settings.getAt(workspace("workspace-a"), historical)).revision,
      "settings-1"
    );

    const [rows] = await connectionB.query(
      `SELECT last_recorded_at, temporal_sequence
       FROM growth_workspace_temporal_barriers
       WHERE workspace_id = ?`,
      ["workspace-a"]
    );
    const row = (rows as Array<Record<string, unknown>>)[0];
    assert.ok(row);
    assert.ok(growthMysqlInstant(row.last_recorded_at) > token.effectiveAsOf);
    assert.ok(Number(row.temporal_sequence) > token.temporalSequence);
  });
  console.log("GROWTH_REAL_MYSQL foundation connections=2 tests=3");
});
