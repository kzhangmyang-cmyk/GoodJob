import assert from "node:assert/strict";
import test from "node:test";
import {
  loadNamedJsonSchema,
  loadNamedOpenApiSource,
  loadSchemaRegistry
} from "./helpers.mjs";

const operations = {
  "/api/v1/growth/bootstrap": ["get"],
  "/api/v1/catalog/items": ["get", "post"],
  "/api/v1/catalog/items/{id}": ["get", "patch"],
  "/api/v1/catalog/items/{id}/retire": ["post"],
  "/api/v1/catalog/pricing-policies": ["get", "post"],
  "/api/v1/catalog/pricing-policies/{id}": ["get"],
  "/api/v1/catalog/pricing-policies/{id}/activate": ["post"],
  "/api/v1/catalog/pricing-policies/{id}/retire": ["post"],
  "/api/v1/catalog/packages/{itemId}/versions": ["get", "post"],
  "/api/v1/catalog/package-versions/{id}": ["get", "patch"],
  "/api/v1/catalog/package-versions/{id}/activate": ["post"],
  "/api/v1/catalog/package-versions/{id}/retire": ["post"],
  "/api/v1/quotes/cases": ["get", "post"],
  "/api/v1/quotes/cases/{id}": ["get"],
  "/api/v1/quotes/cases/{id}/bind-deal": ["post"],
  "/api/v1/quotes/cases/{id}/close": ["post"],
  "/api/v1/quotes/cases/{id}/cancel": ["post"],
  "/api/v1/quotes/cases/{id}/preview": ["post"],
  "/api/v1/quotes/cases/{id}/versions": ["get", "post"],
  "/api/v1/quotes/versions/{id}": ["get"],
  "/api/v1/quotes/versions/{id}/submit": ["post"],
  "/api/v1/quotes/versions/{id}/approve": ["post"],
  "/api/v1/quotes/versions/{id}/reject": ["post"],
  "/api/v1/quotes/versions/{id}/expire": ["post"],
  "/api/v1/quotes/versions/{id}/approvals": ["get"],
  "/api/v1/quotes/publication-operations/{id}": ["get"],
  "/api/v1/quotes/publication-operations/{id}/retry": ["post"],
  "/api/v1/quotes/deals/{dealId}/decision": ["post"],
  "/api/v1/acquisition/cost-entries": ["get", "post"],
  "/api/v1/acquisition/cost-estimates": ["get", "post"],
  "/api/v1/acquisition/cost-estimates/{id}/activate": ["post"],
  "/api/v1/acquisition/cost-estimates/{id}/supersede": ["post"],
  "/api/v1/acquisition/cost-entries/{id}/verify": ["post"],
  "/api/v1/acquisition/cost-entries/{id}/reject": ["post"],
  "/api/v1/acquisition/cost-entries/{id}/reverse": ["post"],
  "/api/v1/acquisition/cost-entries/{id}/correct": ["post"],
  "/api/v1/acquisition/attribution-allocation-sets": ["get", "post"],
  "/api/v1/acquisition/attribution-allocation-sets/{id}": ["get"],
  "/api/v1/acquisition/attribution-allocation-sets/{id}/activate": ["post"],
  "/api/v1/finance/facts": ["get", "post"],
  "/api/v1/finance/facts/{id}/verify": ["post"],
  "/api/v1/finance/facts/{id}/reject": ["post"],
  "/api/v1/finance/facts/{id}/reverse": ["post"],
  "/api/v1/finance/facts/{id}/correct": ["post"],
  "/api/v1/finance/source-reports": ["get", "post"],
  "/api/v1/finance/source-reports/{id}": ["get"],
  "/api/v1/finance/settlement-allocation-sets": ["get", "post"],
  "/api/v1/finance/settlement-allocation-sets/{id}": ["get"],
  "/api/v1/finance/settlement-allocation-sets/{id}/activate": ["post"],
  "/api/v1/finance/import-templates/{kind}": ["get"],
  "/api/v1/finance/imports/preview": ["post"],
  "/api/v1/finance/imports/{previewId}/commit": ["post"],
  "/api/v1/finance/imports/{id}": ["get"],
  "/api/v1/finance/imports/{id}/errors": ["get"],
  "/api/v1/acquisition/cohorts": ["get", "post"],
  "/api/v1/acquisition/cohorts/{id}": ["get"],
  "/api/v1/acquisition/cohorts/{id}/attestations": ["get", "post"],
  "/api/v1/acquisition/cohorts/{id}/close": ["post"],
  "/api/v1/acquisition/cohorts/{id}/closures": ["get"],
  "/api/v1/acquisition/roi-closures/{closureVersionId}/reopen": ["post"],
  "/api/v1/acquisition/growth-performance": ["get"],
  "/api/v1/acquisition/advisor/today": ["get"],
  "/api/v1/acquisition/advisor/recommendations/{id}/accept": ["post"],
  "/api/v1/acquisition/advisor/recommendations/{id}/ignore": ["post"],
  "/api/v1/acquisition/advisor/recommendations/{id}/complete": ["post"]
};

const standardHttpMethods = new Set([
  "get", "put", "post", "delete", "options", "head", "patch", "trace"
]);

const advisorQuoteRiskContractFixture = () => ({
  id: "recommendation-1",
  workspaceId: "workspace-1",
  revision: 1,
  audienceRole: "manager",
  type: "quote_risk",
  summary: "Prioritize the submitted quote that is about to expire",
  rationale: "Quote version quote-v3 expires in 12 hours",
  metricRefs: [{
    kind: "quote_preview",
    quoteCaseId: "quote-case-3",
    previewIdentity: {
      inputSnapshotHash: `sha256:${"a".repeat(64)}`,
      calculationHash: `sha256:${"b".repeat(64)}`,
      pricingPolicyVersionId: "pricing-policy-v7",
      pricingPolicyRevision: 7,
      packageVersionId: "package-v3",
      formulaVersion: "quote-calculation.v1"
    },
    inputSnapshotHash: `sha256:${"a".repeat(64)}`,
    calculationHash: `sha256:${"b".repeat(64)}`
  }],
  evidenceRefs: [{
    kind: "quote_version",
    quoteVersionId: "quote-v3",
    lifecycleRevision: 3,
    commercialAmountHash: `sha256:${"c".repeat(64)}`
  }],
  entityRefs: [{
    kind: "quote_version",
    id: "quote-v3",
    lifecycleRevision: 3,
    commercialAmountHash: `sha256:${"c".repeat(64)}`
  }],
  confidenceBps: 8700,
  riskLevel: "high",
  recommendedAction: {
    kind: "create_quote_approval_task",
    quoteVersionId: "quote-v3",
    quoteVersionRevision: 3
  },
  status: "proposed",
  assignedTo: null,
  acceptedBy: null,
  acceptedAt: null,
  outcomeRefs: [],
  dataAsOf: "2026-08-09T08:00:00.000Z",
  inputSnapshotHash: `sha256:${"d".repeat(64)}`,
  modelSnapshotRef: "model-snapshot-1",
  promptVersion: "growth-advisor.v1",
  schemaVersion: "advisor-recommendation.v1",
  generationIdempotencyKey: "advisor-generation:workspace-1:2026-08-09",
  expiresAt: "2026-08-10T08:00:00.000Z",
  createdAt: "2026-08-09T08:00:00.000Z",
  updatedAt: "2026-08-09T08:00:00.000Z"
});

function findClosedPropertyEnum(schema, definitionName, propertyName) {
  const definitions = schema.$defs ?? schema.definitions ?? {};
  const start = definitions[definitionName] ?? schema;
  const matches = [];
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    const property = value.properties?.[propertyName];
    if (Array.isArray(property?.enum) && property.enum.every((item) => typeof item === "string")) {
      matches.push(property.enum);
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(start);
  assert.equal(matches.length, 1, `${definitionName}.${propertyName}`);
  return matches[0];
}

// Production break caught: deleting or changing a published Growth route/method, or leaking the internal reconciler capability.
test("growth contract publishes the exact route surface", async () => {
  const document = await loadNamedOpenApiSource("growth-advisor-quote-roi.v1.yaml");
  assert.deepEqual(Object.keys(document.paths).sort(), Object.keys(operations).sort());
  for (const [path, methods] of Object.entries(operations)) {
    assert.deepEqual(
      Object.keys(document.paths[path])
        .map((key) => key.toLowerCase())
        .filter((key) => standardHttpMethods.has(key))
        .sort(),
      [...methods].sort(),
      path
    );
  }
  const bootstrap = await loadNamedJsonSchema("growth-bootstrap.v1.schema.json");
  assert.equal(JSON.stringify(bootstrap).includes("acquisition.outcome.reconcile.internal"), false);
});

// Production break caught: accepting a future cutoff, using a per-layer clock, or writing during a rejected closure command.
test("every asOf boundary rejects future cutoff from one server-owned request clock", async () => {
  const document = await loadNamedOpenApiSource("growth-advisor-quote-roi.v1.yaml");
  for (const [path, method] of [
    ["/api/v1/acquisition/growth-performance", "get"],
    ["/api/v1/acquisition/advisor/today", "get"],
    ["/api/v1/acquisition/cohorts/{id}/close", "post"]
  ]) {
    const operation = document.paths[path][method];
    assert.deepEqual(operation["x-goodjob-as-of-upper-bound"], {
      clock: method === "get" ? "readStartedAt" : "commandStartedAt",
      maxFutureSkewSeconds: 1,
      effectiveCutoff: "min(requestedAsOf,startedAt)",
      errorStatus: 422,
      errorCode: "invalid_as_of",
      zeroWritesOnReject: true
    });
    assert.ok(operation.responses["422"], `${method.toUpperCase()} ${path}`);
  }
});

// Production break caught: widening Advisor refs to generic identities or allowing approval actions without a frozen quote revision.
test("advisor recommendation keeps kind-specific refs and quote action revision", async () => {
  const registry = await loadSchemaRegistry();
  const validate = registry.validators.get("advisor-recommendation");
  assert.ok(validate);

  const fixture = advisorQuoteRiskContractFixture();
  assert.equal(validate(fixture), true, JSON.stringify(validate.errors));

  const missingQuoteRevision = structuredClone(fixture);
  delete missingQuoteRevision.recommendedAction.quoteVersionRevision;
  assert.equal(validate(missingQuoteRevision), false);

  const legacyGenericRefs = structuredClone(fixture);
  legacyGenericRefs.metricRefs = [{
    kind: "quote_preview",
    id: "preview-v3",
    revision: 3,
    calculationHash: `sha256:${"b".repeat(64)}`
  }];
  assert.equal(validate(legacyGenericRefs), false);
});

// Production break caught: accepting incomplete gap/ledger evidence, empty plan slices, mutable ownership heads, or unsupported entity kinds.
test("advisor refs freeze gap sources, non-empty ROI slices and real customer/deal authorities", async () => {
  const registry = await loadSchemaRegistry();
  const validate = registry.validators.get("advisor-recommendation");
  assert.ok(validate);

  const gap = advisorQuoteRiskContractFixture();
  gap.metricRefs = [{
    kind: "financial_data_gap",
    gapCode: "missing_commercial_binding",
    sourceType: "commercial_binding",
    sourceId: "deal-7",
    sourceSnapshotHash: `sha256:${"e".repeat(64)}`,
    cohortId: null,
    currency: "CNY",
    asOf: "2026-08-09T08:00:00.000Z"
  }];
  assert.equal(validate(gap), true, JSON.stringify(validate.errors));
  const unknownGapCode = structuredClone(gap);
  unknownGapCode.metricRefs[0].gapCode = "missing_verified_cost";
  assert.equal(validate(unknownGapCode), false);
  const unknownGapSource = structuredClone(gap);
  unknownGapSource.metricRefs[0].sourceType = "inferred_by_model";
  assert.equal(validate(unknownGapSource), false);
  const missingGapSource = structuredClone(gap);
  delete missingGapSource.metricRefs[0].sourceId;
  assert.equal(validate(missingGapSource), false);
  const missingGapSourceSnapshot = structuredClone(gap);
  delete missingGapSourceSnapshot.metricRefs[0].sourceSnapshotHash;
  assert.equal(validate(missingGapSourceSnapshot), false);
  const missingGapCohortRepresentation = structuredClone(gap);
  delete missingGapCohortRepresentation.metricRefs[0].cohortId;
  assert.equal(validate(missingGapCohortRepresentation), false);

  const sliced = advisorQuoteRiskContractFixture();
  sliced.metricRefs = [{
    kind: "growth_performance",
    cohortId: "cohort-1",
    currency: "CNY",
    asOf: "2026-08-09T08:00:00.000Z",
    planId: "plan-1",
    closureVersionId: "closure-1",
    sliceKey: "plan:plan-1",
    calculationHash: `sha256:${"f".repeat(64)}`
  }];
  sliced.evidenceRefs = [{
    kind: "roi_snapshot",
    closureVersionId: "closure-1",
    version: 1,
    sliceKey: "plan:plan-1",
    calculationHash: `sha256:${"f".repeat(64)}`
  }];
  sliced.entityRefs = [{
    kind: "closure_version",
    id: "closure-1",
    version: 1,
    sliceKey: "plan:plan-1",
    calculationHash: `sha256:${"f".repeat(64)}`
  }];
  assert.equal(validate(sliced), true, JSON.stringify(validate.errors));
  for (const branch of ["metricRefs", "evidenceRefs", "entityRefs"]) {
    const emptyPlanSlice = structuredClone(sliced);
    emptyPlanSlice[branch][0].sliceKey = "plan:";
    assert.equal(validate(emptyPlanSlice), false, branch);
  }

  const ledgerBound = advisorQuoteRiskContractFixture();
  ledgerBound.evidenceRefs = [{
    kind: "ledger_entry",
    ledgerType: "financial",
    ledgerEntryId: "financial-fact-1",
    currency: "CNY",
    verificationEventId: "verification-1",
    verificationRevision: 2,
    evidenceHash: `sha256:${"8".repeat(64)}`
  }];
  assert.equal(validate(ledgerBound), true, JSON.stringify(validate.errors));
  const missingLedgerType = structuredClone(ledgerBound);
  delete missingLedgerType.evidenceRefs[0].ledgerType;
  assert.equal(validate(missingLedgerType), false);
  const unknownLedgerType = structuredClone(ledgerBound);
  unknownLedgerType.evidenceRefs[0].ledgerType = "combined";
  assert.equal(validate(unknownLedgerType), false);
  const missingLedgerCurrency = structuredClone(ledgerBound);
  delete missingLedgerCurrency.evidenceRefs[0].currency;
  assert.equal(validate(missingLedgerCurrency), false);

  const authority = advisorQuoteRiskContractFixture();
  authority.entityRefs = [
    {
      kind: "customer",
      id: "customer-1",
      quoteVersionId: "quote-version-1",
      handoffContentHash: `sha256:${"0".repeat(64)}`,
      bindingHashSchemaVersion: "commercial-binding.v1"
    },
    {
      kind: "deal",
      id: "deal-1",
      quoteVersionId: "quote-version-1",
      dealContentHash: `sha256:${"1".repeat(64)}`,
      bindingHashSchemaVersion: "deal-binding.v1",
      dealAuthorityRevision: null
    }
  ];
  assert.equal(validate(authority), true, JSON.stringify(validate.errors));
  const genericCustomer = structuredClone(authority);
  genericCustomer.entityRefs[0] = { kind: "customer", id: "customer-1", revision: 4 };
  assert.equal(validate(genericCustomer), false);
  const missingCustomerHash = structuredClone(authority);
  delete missingCustomerHash.entityRefs[0].handoffContentHash;
  assert.equal(validate(missingCustomerHash), false);
  const missingCustomerQuoteVersion = structuredClone(authority);
  delete missingCustomerQuoteVersion.entityRefs[0].quoteVersionId;
  assert.equal(validate(missingCustomerQuoteVersion), false);
  const genericDeal = structuredClone(authority);
  genericDeal.entityRefs[1] = { kind: "deal", id: "deal-1", revision: 7 };
  assert.equal(validate(genericDeal), false);
  const missingDealAuthority = structuredClone(authority);
  delete missingDealAuthority.entityRefs[1].dealAuthorityRevision;
  assert.equal(validate(missingDealAuthority), false);
  const missingDealQuoteVersion = structuredClone(authority);
  delete missingDealQuoteVersion.entityRefs[1].quoteVersionId;
  assert.equal(validate(missingDealQuoteVersion), false);

  const removedCandidate = structuredClone(authority);
  removedCandidate.entityRefs = [{ kind: "candidate", id: "candidate-1", revision: 1 }];
  assert.equal(validate(removedCandidate), false);
  const removedQuoteCase = structuredClone(authority);
  removedQuoteCase.entityRefs = [{ kind: "quote_case", id: "quote-case-1", revision: 1 }];
  assert.equal(validate(removedQuoteCase), false);
  const removedCohort = structuredClone(authority);
  removedCohort.entityRefs = [{ kind: "cohort", id: "cohort-1", revision: 1 }];
  assert.equal(validate(removedCohort), false);
});

// Production break caught: widening or renaming the shared financial-data-gap code set.
test("financial data gap codes are one exact closed enum", async () => {
  const schema = await loadNamedJsonSchema("advisor-today.v1.schema.json");
  assert.deepEqual(findClosedPropertyEnum(schema, "FinancialDataGapView", "code"), [
    "unverified_cost",
    "unverified_financial_fact",
    "missing_cogs",
    "unmatched_payment",
    "missing_commercial_binding",
    "import_requires_review"
  ]);
  assert.equal(JSON.stringify(schema).includes("missing_verified_cost"), false);
});
