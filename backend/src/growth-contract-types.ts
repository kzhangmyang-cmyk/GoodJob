export type Sha256 = `sha256:${string}`;

export interface QuotePreviewInput {
  catalogItemId: string;
  pricingPolicyVersionId: string;
  quantityMicros: number;
  offeredUnitPriceMinor: number;
  orderDiscountMinor: number;
  paymentTermDays: number;
  giftItems: readonly {
    catalogItemId: string;
    quantityMicros: number;
  }[];
  surchargeContext: {
    region: string | null;
    deliveryMethod: string | null;
  };
  customerTargetPriceMinor: number | null;
  creditRiskBps: number | null;
  manualEscalation: boolean;
}

export interface QuotePreviewIdentity {
  inputSnapshotHash: Sha256;
  calculationHash: Sha256;
  pricingPolicyVersionId: string;
  pricingPolicyRevision: number;
  packageVersionId: string | null;
  formulaVersion: "quote-calculation.v1";
}

export type GrowthRoiSliceKey = "all" | `plan:${string}`;

export type FinancialDataGapCode =
  | "unverified_cost"
  | "unverified_financial_fact"
  | "missing_cogs"
  | "unmatched_payment"
  | "missing_commercial_binding"
  | "import_requires_review";

export type FinancialDataGapSourceType =
  | "cost_entry"
  | "financial_fact"
  | "finance_import"
  | "commercial_binding";

export type AdvisorRecommendedAction =
  | { kind: "open_candidate"; candidateId: string }
  | {
      kind: "create_quote_draft";
      quoteCaseId: string;
      quoteCaseRevision: number;
      quoteInput: QuotePreviewInput;
      previewIdentity: QuotePreviewIdentity;
    }
  | {
      kind: "create_quote_approval_task";
      quoteVersionId: string;
      quoteVersionRevision: number;
    }
  | { kind: "create_sales_todo"; customerId: string; dueAt: string }
  | { kind: "complete_cost_data"; cohortId: string }
  | { kind: "complete_financial_fact"; dealId: string };

export type AdvisorMetricRef =
  | {
      kind: "growth_performance";
      cohortId: string;
      currency: string;
      asOf: string;
      planId: string | null;
      closureVersionId: string | null;
      sliceKey: GrowthRoiSliceKey;
      calculationHash: Sha256;
    }
  | {
      kind: "quote_preview";
      quoteCaseId: string;
      previewIdentity: QuotePreviewIdentity;
      inputSnapshotHash: Sha256;
      calculationHash: Sha256;
    }
  | {
      kind: "priority_score";
      candidateId: string;
      qualificationDecisionId: string;
      qualificationDecisionVersion: string;
      inputSnapshotHash: Sha256;
    }
  | {
      kind: "financial_data_gap";
      gapCode: FinancialDataGapCode;
      sourceType: FinancialDataGapSourceType;
      sourceId: string;
      sourceSnapshotHash: Sha256;
      cohortId: string | null;
      currency: string;
      asOf: string;
    };

export type AdvisorEvidenceRef =
  | {
      kind: "candidate_evidence";
      candidateId: string;
      qualificationDecisionId: string;
      qualificationDecisionVersion: string;
      inputSnapshotHash: Sha256;
      evidenceId: string;
      contentHash: Sha256;
    }
  | {
      kind: "quote_version";
      quoteVersionId: string;
      lifecycleRevision: number;
      commercialAmountHash: Sha256;
    }
  | {
      kind: "ledger_entry";
      ledgerType: "cost" | "financial";
      ledgerEntryId: string;
      currency: string;
      verificationEventId: string;
      verificationRevision: number;
      evidenceHash: Sha256;
    }
  | {
      kind: "roi_snapshot";
      closureVersionId: string;
      version: number;
      sliceKey: GrowthRoiSliceKey;
      calculationHash: Sha256;
    };

export type AdvisorEntityRef =
  | {
      kind: "customer";
      id: string;
      quoteVersionId: string;
      handoffContentHash: Sha256;
      bindingHashSchemaVersion: string;
    }
  | {
      kind: "deal";
      id: string;
      quoteVersionId: string;
      dealContentHash: Sha256;
      bindingHashSchemaVersion: string;
      dealAuthorityRevision: number | null;
    }
  | {
      kind: "quote_version";
      id: string;
      lifecycleRevision: number;
      commercialAmountHash: Sha256;
    }
  | {
      kind: "closure_version";
      id: string;
      version: number;
      sliceKey: GrowthRoiSliceKey;
      calculationHash: Sha256;
    };
