import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { GrowthTemporalBarrier } from "./growth-temporal-barrier.js";
import type {
  GrowthAcquisitionWorkspaceResolver
} from "./growth-workspace-context.js";
import { createGrowthPrivateServiceRegistry } from "./growth-commercial-private-services.js";
import { createGrowthCommercialApplication } from "./growth-commercial-application.js";
import {
  createGrowthCommercialComposition,
  createGrowthCommercialCompositionForStore
} from "./growth-commercial-composition.js";

function foundationPorts() {
  const acquisitionWorkspace = Object.freeze({
    resolve: async () => null
  }) as GrowthAcquisitionWorkspaceResolver;
  const temporalBarrier = Object.freeze({
    allocateAppend: async () => ({
      recordedAt: "2026-08-09T08:00:00.000Z",
      temporalSequence: 1
    }),
    sealReadCutoff: async () => {
      throw new Error("not used");
    }
  }) as GrowthTemporalBarrier;
  return { acquisitionWorkspace, temporalBarrier };
}

test("C0 composition projects exact Foundation ports and no PI authority", () => {
  const foundation = foundationPorts();
  const composition = createGrowthCommercialComposition(foundation);
  const integrations = composition.projectIntegrations(
    createGrowthPrivateServiceRegistry()
  );
  assert.deepEqual(composition.modules, []);
  assert.equal(integrations.acquisitionWorkspace, foundation.acquisitionWorkspace);
  assert.equal(integrations.temporalBarrier, foundation.temporalBarrier);
  assert.equal(integrations.quoteProjectedDocumentAuthority, undefined);
  assert.equal(Object.isFrozen(integrations), true);
});

test("composition rejects missing Foundation ports before publication", () => {
  const foundation = foundationPorts();
  assert.throws(
    () => createGrowthCommercialComposition({
      acquisitionWorkspace: foundation.acquisitionWorkspace
    } as never),
    /MISSING_GROWTH_TEMPORAL_BARRIER/u
  );
  assert.throws(
    () => createGrowthCommercialComposition({
      temporalBarrier: foundation.temporalBarrier
    } as never),
    /MISSING_GROWTH_ACQUISITION_WORKSPACE/u
  );
});

test("composition factories preserve isolated Foundation identities", () => {
  const first = foundationPorts();
  const second = foundationPorts();
  const firstProjection = createGrowthCommercialComposition(first)
    .projectIntegrations(createGrowthPrivateServiceRegistry());
  const secondProjection = createGrowthCommercialComposition(second)
    .projectIntegrations(createGrowthPrivateServiceRegistry());
  assert.notEqual(firstProjection.acquisitionWorkspace, secondProjection.acquisitionWorkspace);
  assert.notEqual(firstProjection.temporalBarrier, secondProjection.temporalBarrier);
});

test("production memory composition installs the Foundation module first", async () => {
  const production = createGrowthCommercialCompositionForStore({
    store: {
      mode: "memory",
      users: [{
        id: "owner-1",
        name: "Owner",
        email: "owner@example.com",
        password: "hash",
        role: "sales",
        teamId: "workspace-1",
        avatar: "",
        status: "active",
        authVersion: 3
      }]
    }
  });
  assert.equal(production.composition.modules.length, 1);
  assert.equal(production.composition.modules[0]?.name, "growth-foundation");
  const runtime = await createGrowthCommercialApplication({
    manifest: { name: "growth", contractVersion: "1.0.0", contractHash: `sha256:${"a".repeat(64)}`, openapiVersion: "3.1.0" },
    requireAuth: ((_req, _res, next) => next()) as express.RequestHandler,
    workspaceMiddleware: ((_req, _res, next) => next()) as express.RequestHandler,
    enabledFeatures: () => [], composition: production.composition
  });
  try {
    const resolved = await runtime.integrations.acquisitionWorkspace.resolve({ ownerId: "owner-1", teamId: "workspace-1" });
    assert.equal(resolved?.workspaceId, "workspace-1");
    assert.equal(resolved?.bindingRevision, "crm-user-auth:3");
  } finally {
    await runtime.close();
  }
});
