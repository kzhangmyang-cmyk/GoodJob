import type { ProbabilityAssessmentV2 } from "./probability-assessment.js";
import type { CommercialBindingSnapshot } from "./commercial-binding-snapshot.js";
import {
  assertConcreteGrowthWorkspaceId,
  assertGrowthTemporalBarrier,
  type GrowthTemporalBarrier,
  type GrowthTemporalTransaction,
  type GrowthTemporalTransactionRunner
} from "./growth-temporal-barrier.js";

export interface QuoteCase {
  readonly id: string;
  readonly workspaceId: string;
  readonly candidateId: string | null;
  readonly customerId: string | null;
  readonly dealId: string | null;
  readonly assignedTo: string;
  readonly status: "open" | "closed" | "cancelled";
  readonly currentDraftVersionId: string | null;
  readonly revision: number;
  readonly commercialBindingSnapshot: CommercialBindingSnapshot | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DealAuthoritativeQuote {
  readonly workspaceId: string;
  readonly dealId: string;
  readonly openQuoteCaseId: string | null;
  readonly quoteVersionId: string | null;
  readonly commercialAmountHash: `sha256:${string}` | null;
  readonly authorityRevision: number;
  readonly updatedAt: string;
}

export interface DealAuthoritativeQuoteEvent {
  readonly id: string;
  readonly workspaceId: string;
  readonly dealId: string;
  readonly authorityRevision: number;
  readonly quoteCaseId: string;
  readonly quoteVersionId: string | null;
  readonly eventType: "case_bound" | "case_released" | "quote_authorized";
  readonly recordedAt: string;
  readonly temporalSequence: number;
}

export interface QuoteVersion {
  readonly id: string;
  readonly workspaceId: string;
  readonly quoteCaseId: string;
  readonly version: number;
  readonly lifecycleRevision: number;
  readonly versionKind: "draft" | "formal";
  readonly sourceDraftVersionId: string | null;
  readonly probabilityAssessmentSnapshot: ProbabilityAssessmentV2 | null;
  readonly status: "draft" | "submitted" | "approved" | "rejected" | "superseded" | "expired";
  readonly createdBy: string;
  readonly createdAt: string;
  readonly effectiveAt: string;
  readonly recordedAt: string;
  readonly temporalSequence: number;
  readonly [key: string]: unknown;
}

export interface QuoteLifecycleEvent {
  readonly id: string;
  readonly workspaceId: string;
  readonly quoteCaseId: string;
  readonly quoteVersionId: string | null;
  readonly revision: number;
  readonly fromStatus: QuoteCase["status"] | QuoteVersion["status"] | null;
  readonly toStatus: QuoteCase["status"] | QuoteVersion["status"];
  readonly eventType: "case_created" | "deal_bound" | "case_closed"
    | "case_cancelled" | "version_expired" | "version_transition";
  readonly actorId: string;
  readonly recordedAt: string;
  readonly temporalSequence: number;
}

export interface QuoteApproval {
  readonly id: string;
  readonly workspaceId: string;
  readonly quoteVersionId: string;
  readonly status: "pending" | "approved" | "rejected" | "cancelled";
  readonly approvalKind: "confirmation" | "exception";
  readonly requiredCapabilities: readonly string[];
  readonly triggeredRules: readonly string[];
  readonly pricingPolicyVersionId: string;
  readonly policySnapshotHash: `sha256:${string}`;
  readonly capabilityRegistryVersion: string;
  readonly submittedBy: string;
  readonly submittedAt: string;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly reason: string | null;
}

export interface QuotePublicationOperation {
  readonly id: string;
  readonly workspaceId: string;
  readonly quoteCaseId: string;
  readonly quoteVersionId: string;
  readonly dealId: string;
  readonly dealAuthorityRevision: number;
  readonly commercialAmountHash: `sha256:${string}`;
  readonly status: "queued" | "running" | "succeeded" | "partial_failure"
    | "failed" | "superseded" | "cancelled";
  readonly piDocumentId: string | null;
  readonly dealEventId: string | null;
  readonly attempts: number;
  readonly lastErrorCode: string | null;
  readonly idempotencyKey: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface QuoteCaseListQuery {
  readonly status?: QuoteCase["status"];
  readonly assignedTo?: string;
  readonly dealId?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface QuoteCasePage {
  readonly items: readonly QuoteCase[];
  readonly nextCursor: string | null;
}

interface QuoteCommandBase {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly commandKey: string;
  readonly requestHash: string;
  readonly expectedRevision: number | null;
}

export interface CreateQuoteCaseCommand extends QuoteCommandBase {
  readonly quoteCase: QuoteCase;
  readonly bindingSnapshot?: CommercialBindingSnapshot | null;
  readonly probabilityAssessment?: ProbabilityAssessmentV2 | null;
}

export interface BindQuoteCaseDealCommand extends QuoteCommandBase {
  readonly quoteCaseId: string;
  readonly dealId: string;
  readonly bindingSnapshot: CommercialBindingSnapshot;
  readonly probabilityAssessment: ProbabilityAssessmentV2;
}

export interface CloseQuoteCaseCommand extends QuoteCommandBase {
  readonly quoteCaseId: string;
}

export interface CancelQuoteCaseCommand extends QuoteCommandBase {
  readonly quoteCaseId: string;
}

export interface QuoteCaseCommandResult {
  readonly quoteCase: QuoteCase;
  readonly replayed: boolean;
}

export interface QuoteRepository {
  listCases(workspaceId: string, query: QuoteCaseListQuery): Promise<QuoteCasePage>;
  findCase(workspaceId: string, id: string): Promise<QuoteCase | null>;
  createCase(command: CreateQuoteCaseCommand): Promise<QuoteCaseCommandResult>;
  bindCaseDeal(command: BindQuoteCaseDealCommand): Promise<QuoteCaseCommandResult>;
  closeCase(command: CloseQuoteCaseCommand): Promise<QuoteCaseCommandResult>;
  cancelCase(command: CancelQuoteCaseCommand): Promise<QuoteCaseCommandResult>;
}

interface Receipt {
  requestHash: string;
  quoteCaseId: string;
}

function quoteError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

function required(value: string, code: string) {
  const result = value.trim();
  if (!result) throw quoteError(code);
  return result;
}

function immutableCase(value: QuoteCase): QuoteCase {
  return Object.freeze({
    ...structuredClone(value),
    commercialBindingSnapshot: value.commercialBindingSnapshot
      ? Object.freeze(structuredClone(value.commercialBindingSnapshot))
      : null
  });
}

function validateVersion(version: QuoteVersion): QuoteVersion {
  const valid = version.versionKind === "draft"
    ? version.sourceDraftVersionId === null
      && version.probabilityAssessmentSnapshot === null
    : Boolean(version.sourceDraftVersionId)
      && version.probabilityAssessmentSnapshot !== null;
  if (!valid) throw quoteError("invalid_quote_version_authority");
  return Object.freeze(structuredClone(version));
}

export interface InMemoryQuoteRepositorySeed {
  readonly cases?: readonly QuoteCase[];
  readonly versions?: readonly QuoteVersion[];
}

export class InMemoryQuoteRepository implements QuoteRepository {
  private readonly cases = new Map<string, QuoteCase>();
  private readonly versions = new Map<string, QuoteVersion>();
  private readonly lifecycleEvents: QuoteLifecycleEvent[] = [];
  private readonly bindingSnapshots = new Map<string, CommercialBindingSnapshot>();
  private readonly boundAssessments = new Map<string, ProbabilityAssessmentV2>();
  private readonly dealAuthorities = new Map<string, DealAuthoritativeQuote>();
  private readonly authorityEvents: DealAuthoritativeQuoteEvent[] = [];
  private readonly receipts = new Map<string, Receipt>();
  private readonly workspaceMutationTails = new Map<string, Promise<void>>();
  private readonly temporalBarrier: GrowthTemporalBarrier;

  constructor(
    private readonly transactions: GrowthTemporalTransactionRunner,
    temporalBarrier: GrowthTemporalBarrier,
    seed: InMemoryQuoteRepositorySeed = {}
  ) {
    this.temporalBarrier = assertGrowthTemporalBarrier(temporalBarrier);
    for (const quoteCase of seed.cases ?? []) {
      this.cases.set(this.caseKey(quoteCase.workspaceId, quoteCase.id),
        immutableCase(quoteCase));
      this.lifecycleEvents.push(Object.freeze({
        id: `seed-lifecycle-${quoteCase.id}`,
        workspaceId: quoteCase.workspaceId,
        quoteCaseId: quoteCase.id,
        quoteVersionId: null,
        revision: 1,
        fromStatus: null,
        toStatus: "open",
        eventType: "case_created",
        actorId: quoteCase.assignedTo,
        recordedAt: quoteCase.createdAt,
        temporalSequence: this.lifecycleEvents.length + 1
      }));
    }
    for (const version of seed.versions ?? []) {
      this.versions.set(this.caseKey(version.workspaceId, version.id),
        validateVersion(version));
    }
  }

  private caseKey(workspaceId: string, id: string) {
    return `${workspaceId}\u0000${id}`;
  }

  private snapshotState() {
    return {
      cases: new Map(this.cases), versions: new Map(this.versions),
      lifecycleEvents: [...this.lifecycleEvents],
      bindingSnapshots: new Map(this.bindingSnapshots),
      boundAssessments: new Map(this.boundAssessments),
      dealAuthorities: new Map(this.dealAuthorities),
      authorityEvents: [...this.authorityEvents], receipts: new Map(this.receipts)
    };
  }

  private restoreState(snapshot: ReturnType<InMemoryQuoteRepository["snapshotState"]>) {
    const restoreMap = <K, V>(target: Map<K, V>, source: Map<K, V>) => {
      target.clear();
      for (const [key, value] of source) target.set(key, value);
    };
    restoreMap(this.cases, snapshot.cases);
    restoreMap(this.versions, snapshot.versions);
    restoreMap(this.bindingSnapshots, snapshot.bindingSnapshots);
    restoreMap(this.boundAssessments, snapshot.boundAssessments);
    restoreMap(this.dealAuthorities, snapshot.dealAuthorities);
    restoreMap(this.receipts, snapshot.receipts);
    this.lifecycleEvents.splice(0, this.lifecycleEvents.length,
      ...snapshot.lifecycleEvents);
    this.authorityEvents.splice(0, this.authorityEvents.length,
      ...snapshot.authorityEvents);
  }

  private async acquireWorkspaceMutationGate(workspaceId: string) {
    const predecessor = this.workspaceMutationTails.get(workspaceId)
      ?? Promise.resolve();
    let unlock!: () => void;
    const current = new Promise<void>((resolve) => { unlock = resolve; });
    this.workspaceMutationTails.set(workspaceId, current);
    await predecessor;
    return () => {
      unlock();
      if (this.workspaceMutationTails.get(workspaceId) === current) {
        this.workspaceMutationTails.delete(workspaceId);
      }
    };
  }

  private async mutation<T>(
    workspaceId: string,
    work: (
      tx: GrowthTemporalTransaction,
      firstStamp: { recordedAt: string; temporalSequence: number }
    ) => Promise<T>
  ): Promise<T> {
    let release: (() => void) | undefined;
    let snapshot: ReturnType<InMemoryQuoteRepository["snapshotState"]>
      | undefined;
    try {
      return await this.transactions.run(async (tx) => {
        const firstStamp = await this.temporalBarrier.allocateAppend(
          tx,
          workspaceId
        );
        release = await this.acquireWorkspaceMutationGate(workspaceId);
        snapshot = this.snapshotState();
        return work(tx, firstStamp);
      });
    } catch (error) {
      if (snapshot) this.restoreState(snapshot);
      throw error;
    } finally {
      release?.();
    }
  }

  private receiptKey(workspaceId: string, commandKey: string) {
    return `${workspaceId}\u0000${commandKey}`;
  }

  private replay(command: QuoteCommandBase): QuoteCaseCommandResult | null {
    const receipt = this.receipts.get(this.receiptKey(
      command.workspaceId,
      required(command.commandKey, "invalid_quote_command_key")
    ));
    if (!receipt) return null;
    if (receipt.requestHash !== command.requestHash) {
      throw quoteError("quote_command_identity_conflict");
    }
    const quoteCase = this.cases.get(this.caseKey(
      command.workspaceId,
      receipt.quoteCaseId
    ));
    if (!quoteCase) throw quoteError("quote_command_receipt_corrupt");
    return { quoteCase, replayed: true };
  }

  private complete(command: QuoteCommandBase, quoteCase: QuoteCase) {
    this.receipts.set(this.receiptKey(command.workspaceId, command.commandKey), {
      requestHash: command.requestHash,
      quoteCaseId: quoteCase.id
    });
  }

  private currentCase(command: QuoteCommandBase, id: string): QuoteCase {
    const quoteCase = this.cases.get(this.caseKey(command.workspaceId, id));
    if (!quoteCase) throw quoteError("quote_case_not_found");
    if (command.expectedRevision !== quoteCase.revision) {
      throw quoteError(command.expectedRevision === null
        ? "revision_required" : "quote_case_revision_conflict");
    }
    return quoteCase;
  }

  private activeFormalVersion(workspaceId: string, quoteCaseId: string) {
    return [...this.versions.values()].some((version) =>
      version.workspaceId === workspaceId
      && version.quoteCaseId === quoteCaseId
      && version.versionKind === "formal"
      && (version.status === "submitted" || version.status === "approved"));
  }

  private appendCaseLifecycle(input: Omit<QuoteLifecycleEvent,
    "id" | "recordedAt" | "temporalSequence">,
  stamp: { recordedAt: string; temporalSequence: number }) {
    this.lifecycleEvents.push(Object.freeze({
      ...input,
      id: `quote-lifecycle-${input.workspaceId}-${stamp.temporalSequence}`,
      ...stamp
    }));
  }

  async listCases(workspaceId: string, query: QuoteCaseListQuery) {
    const workspace = assertConcreteGrowthWorkspaceId(workspaceId);
    const limit = Math.min(100, Math.max(1, query.limit ?? 50));
    const rows = [...this.cases.values()]
      .filter((row) => row.workspaceId === workspace
        && (!query.status || row.status === query.status)
        && (!query.assignedTo || row.assignedTo === query.assignedTo)
        && (!query.dealId || row.dealId === query.dealId)
        && (!query.cursor || row.id > query.cursor))
      .sort((left, right) => left.id.localeCompare(right.id));
    return Object.freeze({
      items: Object.freeze(rows.slice(0, limit)),
      nextCursor: rows.length > limit ? rows[limit - 1]!.id : null
    });
  }

  async findCase(workspaceId: string, id: string) {
    return this.cases.get(this.caseKey(
      assertConcreteGrowthWorkspaceId(workspaceId),
      required(id, "invalid_quote_case_id")
    )) ?? null;
  }

  async createCase(command: CreateQuoteCaseCommand) {
    command = { ...command,
      workspaceId: assertConcreteGrowthWorkspaceId(command.workspaceId) };
    const replay = this.replay(command);
    if (replay) return replay;
    return this.mutation(command.workspaceId, async (tx, caseStamp) => {
      const secondReplay = this.replay(command);
      if (secondReplay) return secondReplay;
      const value = command.quoteCase;
      if (value.workspaceId !== command.workspaceId || value.revision !== 1
        || value.status !== "open" || value.assignedTo.trim() === ""
        || (!value.candidateId && !value.customerId && !value.dealId)
        || this.cases.has(this.caseKey(value.workspaceId, value.id))) {
        throw quoteError("invalid_quote_case_create");
      }
      if (value.dealId) {
        if (!command.bindingSnapshot || !command.probabilityAssessment) {
          throw quoteError("commercial_binding_required");
        }
        const conflict = [...this.cases.values()].some((row) =>
          row.workspaceId === value.workspaceId && row.dealId === value.dealId
          && row.status === "open");
        if (conflict) throw quoteError("deal_open_quote_case_conflict");
      }
      const stored = immutableCase({ ...value,
        createdAt: caseStamp.recordedAt, updatedAt: caseStamp.recordedAt });
      this.cases.set(this.caseKey(stored.workspaceId, stored.id), stored);
      if (command.bindingSnapshot && command.probabilityAssessment) {
        await this.temporalBarrier.allocateAppend(tx, command.workspaceId);
        this.bindingSnapshots.set(this.caseKey(stored.workspaceId, stored.id),
          Object.freeze(structuredClone(command.bindingSnapshot)));
        this.boundAssessments.set(this.caseKey(stored.workspaceId, stored.id),
          Object.freeze(structuredClone(command.probabilityAssessment)));
        this.dealAuthorities.set(this.caseKey(stored.workspaceId, stored.dealId!),
          Object.freeze({ workspaceId: stored.workspaceId, dealId: stored.dealId!,
            openQuoteCaseId: stored.id, quoteVersionId: null,
            commercialAmountHash: null, authorityRevision: 1,
            updatedAt: caseStamp.recordedAt }));
      }
      const lifecycleStamp = await this.temporalBarrier.allocateAppend(
        tx,
        command.workspaceId
      );
      this.appendCaseLifecycle({
        workspaceId: stored.workspaceId, quoteCaseId: stored.id,
        quoteVersionId: null, revision: 1, fromStatus: null,
        toStatus: "open", eventType: "case_created", actorId: command.actorId
      }, lifecycleStamp);
      if (stored.dealId) {
        const authorityStamp = await this.temporalBarrier.allocateAppend(
          tx,
          command.workspaceId
        );
        this.authorityEvents.push(Object.freeze({
          id: `deal-quote-authority-${stored.workspaceId}-${authorityStamp.temporalSequence}`,
          workspaceId: stored.workspaceId, dealId: stored.dealId,
          authorityRevision: 1, quoteCaseId: stored.id, quoteVersionId: null,
          eventType: "case_bound", ...authorityStamp
        }));
      }
      this.complete(command, stored);
      return { quoteCase: stored, replayed: false };
    });
  }

  async bindCaseDeal(command: BindQuoteCaseDealCommand) {
    command = { ...command,
      workspaceId: assertConcreteGrowthWorkspaceId(command.workspaceId) };
    const replay = this.replay(command);
    if (replay) return replay;
    return this.mutation(command.workspaceId, async (tx, caseStamp) => {
      const secondReplay = this.replay(command);
      if (secondReplay) return secondReplay;
      const current = this.currentCase(command, command.quoteCaseId);
      if (current.status !== "open") throw quoteError("quote_case_not_open");
      if (current.dealId) {
        if (current.dealId !== command.dealId) {
          throw quoteError("quote_case_rebind_forbidden");
        }
        this.complete(command, current);
        return { quoteCase: current, replayed: true };
      }
      if (command.bindingSnapshot.dealId !== command.dealId
        || command.bindingSnapshot.candidateId !== current.candidateId
        || command.probabilityAssessment.workspaceId !== command.workspaceId
        || command.probabilityAssessment.candidateId !== current.candidateId
        || command.probabilityAssessment.dealId !== command.dealId) {
        throw quoteError("commercial_binding_authority_mismatch");
      }
      const authorityKey = this.caseKey(command.workspaceId, command.dealId);
      const guard = this.dealAuthorities.get(authorityKey);
      if (guard?.openQuoteCaseId && guard.openQuoteCaseId !== current.id) {
        throw quoteError("deal_open_quote_case_conflict");
      }
      const conflicting = [...this.cases.values()].some((row) =>
        row.workspaceId === command.workspaceId && row.dealId === command.dealId
        && row.status === "open" && row.id !== current.id);
      if (conflicting) throw quoteError("deal_open_quote_case_conflict");
      const stored = immutableCase({ ...current,
        customerId: command.bindingSnapshot.customerId,
        dealId: command.dealId,
        revision: current.revision + 1,
        commercialBindingSnapshot: command.bindingSnapshot,
        updatedAt: caseStamp.recordedAt
      });
      const nextAuthorityRevision = (guard?.authorityRevision ?? 0) + 1;
      this.dealAuthorities.set(authorityKey, Object.freeze({
        workspaceId: command.workspaceId, dealId: command.dealId,
        openQuoteCaseId: stored.id, quoteVersionId: guard?.quoteVersionId ?? null,
        commercialAmountHash: guard?.commercialAmountHash ?? null,
        authorityRevision: nextAuthorityRevision, updatedAt: caseStamp.recordedAt
      }));
      this.cases.set(this.caseKey(stored.workspaceId, stored.id), stored);
      await this.temporalBarrier.allocateAppend(tx, command.workspaceId);
      this.bindingSnapshots.set(this.caseKey(stored.workspaceId, stored.id),
        Object.freeze(structuredClone(command.bindingSnapshot)));
      this.boundAssessments.set(this.caseKey(stored.workspaceId, stored.id),
        Object.freeze(structuredClone(command.probabilityAssessment)));
      const lifecycleStamp = await this.temporalBarrier.allocateAppend(
        tx,
        command.workspaceId
      );
      this.appendCaseLifecycle({
        workspaceId: stored.workspaceId, quoteCaseId: stored.id,
        quoteVersionId: null, revision: stored.revision,
        fromStatus: "open", toStatus: "open", eventType: "deal_bound",
        actorId: command.actorId
      }, lifecycleStamp);
      const authorityStamp = await this.temporalBarrier.allocateAppend(
        tx,
        command.workspaceId
      );
      this.authorityEvents.push(Object.freeze({
        id: `deal-quote-authority-${command.workspaceId}-${authorityStamp.temporalSequence}`,
        workspaceId: command.workspaceId, dealId: command.dealId,
        authorityRevision: nextAuthorityRevision, quoteCaseId: stored.id,
        quoteVersionId: null, eventType: "case_bound", ...authorityStamp
      }));
      this.complete(command, stored);
      return { quoteCase: stored, replayed: false };
    });
  }

  private async terminal(
    command: CloseQuoteCaseCommand | CancelQuoteCaseCommand,
    status: "closed" | "cancelled"
  ): Promise<QuoteCaseCommandResult> {
    command = { ...command,
      workspaceId: assertConcreteGrowthWorkspaceId(command.workspaceId) };
    const replay = this.replay(command);
    if (replay) return replay;
    return this.mutation(command.workspaceId, async (tx, stamp) => {
      const secondReplay = this.replay(command);
      if (secondReplay) return secondReplay;
      const current = this.currentCase(command, command.quoteCaseId);
      if (current.status !== "open") throw quoteError("quote_case_not_open");
      if (this.activeFormalVersion(command.workspaceId, current.id)) {
        throw quoteError("quote_case_has_active_formal_version");
      }
      if (status === "cancelled") {
        for (const [key, version] of this.versions) {
          if (version.workspaceId === command.workspaceId
            && version.quoteCaseId === current.id
            && version.status === "draft") {
            this.versions.set(key, Object.freeze({ ...version,
              status: "expired",
              lifecycleRevision: version.lifecycleRevision + 1
            }));
            const versionStamp = await this.temporalBarrier.allocateAppend(
              tx,
              command.workspaceId
            );
            this.appendCaseLifecycle({
              workspaceId: command.workspaceId, quoteCaseId: current.id,
              quoteVersionId: version.id,
              revision: version.lifecycleRevision + 1,
              fromStatus: "draft", toStatus: "expired",
              eventType: "version_expired", actorId: command.actorId
            }, versionStamp);
          }
        }
      }
      const stored = immutableCase({ ...current, status,
        revision: current.revision + 1, updatedAt: stamp.recordedAt });
      this.cases.set(this.caseKey(stored.workspaceId, stored.id), stored);
      const lifecycleStamp = await this.temporalBarrier.allocateAppend(
        tx,
        command.workspaceId
      );
      this.appendCaseLifecycle({
        workspaceId: stored.workspaceId, quoteCaseId: stored.id,
        quoteVersionId: null, revision: stored.revision,
        fromStatus: "open", toStatus: status,
        eventType: status === "closed" ? "case_closed" : "case_cancelled",
        actorId: command.actorId
      }, lifecycleStamp);
      if (stored.dealId) {
        const authorityKey = this.caseKey(stored.workspaceId, stored.dealId);
        const guard = this.dealAuthorities.get(authorityKey);
        if (guard?.openQuoteCaseId === stored.id) {
          this.dealAuthorities.set(authorityKey, Object.freeze({ ...guard,
            openQuoteCaseId: null, authorityRevision: guard.authorityRevision + 1,
            updatedAt: stamp.recordedAt }));
        }
      }
      this.complete(command, stored);
      return { quoteCase: stored, replayed: false };
    });
  }

  closeCase(command: CloseQuoteCaseCommand) {
    return this.terminal(command, "closed");
  }

  cancelCase(command: CancelQuoteCaseCommand) {
    return this.terminal(command, "cancelled");
  }

  async countCases(workspaceId: string) {
    return [...this.cases.values()].filter((row) =>
      row.workspaceId === workspaceId).length;
  }

  async countBindings(workspaceId: string) {
    return [...this.bindingSnapshots.keys()].filter((key) =>
      key.startsWith(`${workspaceId}\u0000`)).length;
  }

  async countLifecycleEvents(workspaceId: string) {
    return this.lifecycleEvents.filter((row) =>
      row.workspaceId === workspaceId).length;
  }

  async listVersionStatuses(workspaceId: string, quoteCaseId: string) {
    return [...this.versions.values()].filter((row) =>
      row.workspaceId === workspaceId && row.quoteCaseId === quoteCaseId)
      .map((row) => row.status);
  }

  async boundProbabilityAssessmentId(workspaceId: string, quoteCaseId: string) {
    return this.boundAssessments.get(this.caseKey(workspaceId, quoteCaseId))?.id
      ?? null;
  }

  async findDealAuthority(workspaceId: string, dealId: string) {
    return this.dealAuthorities.get(this.caseKey(workspaceId, dealId)) ?? null;
  }
}
