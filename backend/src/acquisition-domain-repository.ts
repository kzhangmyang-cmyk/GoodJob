import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type {
  AcquisitionAuditEvent,
  AcquisitionCandidate,
  BattleCard,
  DiscoveryEvidence,
  FinancialValueDecision,
  IdempotencyRecord,
  LeadConversionRecord,
  LiveOutcomeFeedbackEvent,
  QualificationDecision,
  ResearchAttempt,
  ReviewEvent
} from "./acquisition-domain.js";

export interface AcquisitionDataScope {
  ownerId: string;
  teamId: string;
}

export interface AcquisitionCandidateListQuery {
  cursor?: string;
  snapshot?: string;
  limit: number;
  subjectKind?: "organization" | "individual";
  status?: AcquisitionCandidate["status"];
}

export interface AcquisitionCandidateListPage {
  items: AcquisitionCandidate[];
  nextCursor: string | null;
  snapshot: string;
}

export interface AcquisitionDomainRepository {
  transaction<T>(work: () => Promise<T>): Promise<T>;
  findEvidence(
    scope: AcquisitionDataScope,
    evidenceId: string
  ): Promise<DiscoveryEvidence | null>;
  appendEvidence(evidence: DiscoveryEvidence): Promise<void>;
  findCandidate(
    scope: AcquisitionDataScope,
    candidateId: string
  ): Promise<AcquisitionCandidate | null>;
  listCandidates(
    scope: AcquisitionDataScope,
    query: AcquisitionCandidateListQuery
  ): Promise<AcquisitionCandidateListPage>;
  insertCandidate(candidate: AcquisitionCandidate): Promise<void>;
  saveCandidate(candidate: AcquisitionCandidate): Promise<void>;
  appendQualificationDecision(decision: QualificationDecision): Promise<void>;
  findQualificationDecision(
    scope: AcquisitionDataScope,
    candidateId: string,
    decisionId: string
  ): Promise<QualificationDecision | null>;
  listQualificationDecisions(
    scope: AcquisitionDataScope,
    candidateId: string
  ): Promise<QualificationDecision[]>;
  appendFinancialValue(decision: FinancialValueDecision): Promise<void>;
  listFinancialValues(
    scope: AcquisitionDataScope,
    candidateId: string
  ): Promise<FinancialValueDecision[]>;
  appendBattleCard(card: BattleCard): Promise<void>;
  listBattleCards(
    scope: AcquisitionDataScope,
    candidateId: string
  ): Promise<BattleCard[]>;
  appendReviewEvent(event: ReviewEvent): Promise<void>;
  listReviewEvents(
    scope: AcquisitionDataScope,
    candidateId: string
  ): Promise<ReviewEvent[]>;
  appendResearchAttempt(attempt: ResearchAttempt): Promise<void>;
  saveResearchAttempt(attempt: ResearchAttempt): Promise<void>;
  findResearchAttempt(
    scope: AcquisitionDataScope,
    candidateId: string,
    researchId: string
  ): Promise<ResearchAttempt | null>;
  appendConversion(record: LeadConversionRecord): Promise<void>;
  findConversion(
    scope: AcquisitionDataScope,
    candidateId: string
  ): Promise<LeadConversionRecord | null>;
  appendOutcome(event: LiveOutcomeFeedbackEvent): Promise<void>;
  listOutcomes(
    scope: AcquisitionDataScope,
    candidateId: string
  ): Promise<LiveOutcomeFeedbackEvent[]>;
  appendAuditEvent(event: AcquisitionAuditEvent): Promise<void>;
  listAuditEvents(
    scope: AcquisitionDataScope,
    candidateId: string | null
  ): Promise<AcquisitionAuditEvent[]>;
  findIdempotency(
    scope: AcquisitionDataScope,
    operation: string,
    idempotencyKey: string
  ): Promise<IdempotencyRecord | null>;
  appendIdempotency(record: IdempotencyRecord): Promise<void>;
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

function belongs(
  value: { ownerId: string; teamId: string },
  scope: AcquisitionDataScope
) {
  return value.ownerId === scope.ownerId && value.teamId === scope.teamId;
}

function idempotencyMapKey(
  scope: AcquisitionDataScope,
  operation: string,
  idempotencyKey: string
) {
  return `${scope.ownerId}\u0000${scope.teamId}\u0000${operation}\u0000${idempotencyKey}`;
}

function candidateSnapshot(candidates: AcquisitionCandidate[]) {
  const identity = candidates.map((candidate) => [
    candidate.id,
    candidate.version,
    candidate.status,
    candidate.updatedAt
  ]);
  return createHash("sha256")
    .update(JSON.stringify(identity))
    .digest("hex");
}

function candidateCursor(value: string | undefined) {
  if (value === undefined) return 0;
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error("CANDIDATE_CURSOR_INVALID");
  }
  const offset = Number(value);
  if (!Number.isSafeInteger(offset)) {
    throw new Error("CANDIDATE_CURSOR_INVALID");
  }
  return offset;
}

export class InMemoryAcquisitionDomainRepository
implements AcquisitionDomainRepository {
  private readonly evidence = new Map<string, DiscoveryEvidence>();
  private readonly candidates = new Map<string, AcquisitionCandidate>();
  private readonly qualificationDecisions: QualificationDecision[] = [];
  private readonly financialValues: FinancialValueDecision[] = [];
  private readonly battleCards: BattleCard[] = [];
  private readonly reviewEvents: ReviewEvent[] = [];
  private readonly researchAttempts = new Map<string, ResearchAttempt>();
  private readonly conversions: LeadConversionRecord[] = [];
  private readonly outcomes: LiveOutcomeFeedbackEvent[] = [];
  private readonly auditEvents: AcquisitionAuditEvent[] = [];
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private readonly transactionContext =
    new AsyncLocalStorage<{ active: boolean }>();
  private transactionTail: Promise<void> = Promise.resolve();

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    if (this.transactionContext.getStore()?.active) return work();
    let release!: () => void;
    const previous = this.transactionTail;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const snapshot = {
      evidence: new Map(
        [...this.evidence.entries()].map(([key, value]) => [key, copy(value)])
      ),
      candidates: new Map(
        [...this.candidates.entries()].map(([key, value]) => [key, copy(value)])
      ),
      qualificationDecisions: copy(this.qualificationDecisions),
      financialValues: copy(this.financialValues),
      battleCards: copy(this.battleCards),
      reviewEvents: copy(this.reviewEvents),
      researchAttempts: new Map(
        [...this.researchAttempts.entries()]
          .map(([key, value]) => [key, copy(value)])
      ),
      conversions: copy(this.conversions),
      outcomes: copy(this.outcomes),
      auditEvents: copy(this.auditEvents),
      idempotency: new Map(
        [...this.idempotency.entries()].map(([key, value]) => [key, copy(value)])
      )
    };
    const context = { active: true };
    try {
      return await this.transactionContext.run(context, work);
    } catch (error) {
      this.evidence.clear();
      snapshot.evidence.forEach((value, key) => this.evidence.set(key, value));
      this.candidates.clear();
      snapshot.candidates.forEach(
        (value, key) => this.candidates.set(key, value)
      );
      this.qualificationDecisions.splice(
        0,
        this.qualificationDecisions.length,
        ...snapshot.qualificationDecisions
      );
      this.financialValues.splice(
        0,
        this.financialValues.length,
        ...snapshot.financialValues
      );
      this.battleCards.splice(
        0,
        this.battleCards.length,
        ...snapshot.battleCards
      );
      this.reviewEvents.splice(
        0,
        this.reviewEvents.length,
        ...snapshot.reviewEvents
      );
      this.researchAttempts.clear();
      snapshot.researchAttempts.forEach(
        (value, key) => this.researchAttempts.set(key, value)
      );
      this.conversions.splice(
        0,
        this.conversions.length,
        ...snapshot.conversions
      );
      this.outcomes.splice(0, this.outcomes.length, ...snapshot.outcomes);
      this.auditEvents.splice(
        0,
        this.auditEvents.length,
        ...snapshot.auditEvents
      );
      this.idempotency.clear();
      snapshot.idempotency.forEach(
        (value, key) => this.idempotency.set(key, value)
      );
      throw error;
    } finally {
      context.active = false;
      release();
    }
  }

  async findEvidence(scope: AcquisitionDataScope, evidenceId: string) {
    const evidence = this.evidence.get(evidenceId);
    return evidence && belongs(evidence, scope) ? copy(evidence) : null;
  }

  async appendEvidence(evidence: DiscoveryEvidence) {
    if (this.evidence.has(evidence.id)) {
      throw new Error(`duplicate evidence id: ${evidence.id}`);
    }
    this.evidence.set(evidence.id, copy(evidence));
  }

  async findCandidate(scope: AcquisitionDataScope, candidateId: string) {
    const candidate = this.candidates.get(candidateId);
    return candidate && belongs(candidate, scope) ? copy(candidate) : null;
  }

  async listCandidates(
    scope: AcquisitionDataScope,
    query: AcquisitionCandidateListQuery
  ) {
    if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 100) {
      throw new Error("CANDIDATE_LIMIT_INVALID");
    }
    const candidates = [...this.candidates.values()]
      .filter((candidate) =>
        belongs(candidate, scope)
        && (!query.subjectKind || candidate.profile.kind === query.subjectKind)
        && (!query.status || candidate.status === query.status)
      )
      .sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt)
        || left.id.localeCompare(right.id)
      );
    const snapshot = candidateSnapshot(candidates);
    if (query.snapshot && query.snapshot !== snapshot) {
      throw new Error("CANDIDATE_SNAPSHOT_CHANGED");
    }
    const offset = candidateCursor(query.cursor);
    const items = candidates.slice(offset, offset + query.limit).map(copy);
    const nextOffset = offset + items.length;
    return {
      items,
      nextCursor: nextOffset < candidates.length ? String(nextOffset) : null,
      snapshot
    };
  }

  async insertCandidate(candidate: AcquisitionCandidate) {
    if (this.candidates.has(candidate.id)) {
      throw new Error(`duplicate candidate id: ${candidate.id}`);
    }
    this.candidates.set(candidate.id, copy(candidate));
  }

  async saveCandidate(candidate: AcquisitionCandidate) {
    const current = this.candidates.get(candidate.id);
    if (!current || !belongs(current, candidate)) {
      throw new Error(`candidate not found: ${candidate.id}`);
    }
    this.candidates.set(candidate.id, copy(candidate));
  }

  async appendQualificationDecision(decision: QualificationDecision) {
    this.qualificationDecisions.push(copy(decision));
  }

  async findQualificationDecision(
    scope: AcquisitionDataScope,
    candidateId: string,
    decisionId: string
  ) {
    const decision = this.qualificationDecisions.find((item) =>
      item.id === decisionId
      && item.candidateId === candidateId
      && belongs(item, scope)
    );
    return decision ? copy(decision) : null;
  }

  async listQualificationDecisions(
    scope: AcquisitionDataScope,
    candidateId: string
  ) {
    return this.qualificationDecisions
      .filter((item) => item.candidateId === candidateId && belongs(item, scope))
      .map(copy);
  }

  async appendFinancialValue(decision: FinancialValueDecision) {
    this.financialValues.push(copy(decision));
  }

  async listFinancialValues(
    scope: AcquisitionDataScope,
    candidateId: string
  ) {
    return this.financialValues
      .filter((item) => item.candidateId === candidateId && belongs(item, scope))
      .map(copy);
  }

  async appendBattleCard(card: BattleCard) {
    this.battleCards.push(copy(card));
  }

  async listBattleCards(scope: AcquisitionDataScope, candidateId: string) {
    return this.battleCards
      .filter((item) => item.candidateId === candidateId && belongs(item, scope))
      .map(copy);
  }

  async appendReviewEvent(event: ReviewEvent) {
    this.reviewEvents.push(copy(event));
  }

  async listReviewEvents(scope: AcquisitionDataScope, candidateId: string) {
    return this.reviewEvents
      .filter((item) => item.candidateId === candidateId && belongs(item, scope))
      .map(copy);
  }

  async appendResearchAttempt(attempt: ResearchAttempt) {
    if (this.researchAttempts.has(attempt.id)) {
      throw new Error(`duplicate research id: ${attempt.id}`);
    }
    this.researchAttempts.set(attempt.id, copy(attempt));
  }

  async saveResearchAttempt(attempt: ResearchAttempt) {
    const current = this.researchAttempts.get(attempt.id);
    if (!current || !belongs(current, attempt)) {
      throw new Error(`research attempt not found: ${attempt.id}`);
    }
    this.researchAttempts.set(attempt.id, copy(attempt));
  }

  async findResearchAttempt(
    scope: AcquisitionDataScope,
    candidateId: string,
    researchId: string
  ) {
    const attempt = this.researchAttempts.get(researchId);
    return attempt
      && attempt.candidateId === candidateId
      && belongs(attempt, scope)
      ? copy(attempt)
      : null;
  }

  async appendConversion(record: LeadConversionRecord) {
    this.conversions.push(copy(record));
  }

  async findConversion(scope: AcquisitionDataScope, candidateId: string) {
    const result = this.conversions.find((item) =>
      item.candidateId === candidateId && belongs(item, scope)
    );
    return result ? copy(result) : null;
  }

  async appendOutcome(event: LiveOutcomeFeedbackEvent) {
    this.outcomes.push(copy(event));
  }

  async listOutcomes(scope: AcquisitionDataScope, candidateId: string) {
    return this.outcomes
      .filter((item) => item.candidateId === candidateId && belongs(item, scope))
      .map(copy);
  }

  async appendAuditEvent(event: AcquisitionAuditEvent) {
    this.auditEvents.push(copy(event));
  }

  async listAuditEvents(
    scope: AcquisitionDataScope,
    candidateId: string | null
  ) {
    return this.auditEvents
      .filter((item) =>
        belongs(item, scope)
        && (candidateId === null || item.candidateId === candidateId)
      )
      .map(copy);
  }

  async findIdempotency(
    scope: AcquisitionDataScope,
    operation: string,
    idempotencyKey: string
  ) {
    const result = this.idempotency.get(
      idempotencyMapKey(scope, operation, idempotencyKey)
    );
    return result ? copy(result) : null;
  }

  async appendIdempotency(record: IdempotencyRecord) {
    const key = idempotencyMapKey(
      record,
      record.operation,
      record.idempotencyKey
    );
    if (this.idempotency.has(key)) {
      throw new Error(`duplicate idempotency key: ${record.idempotencyKey}`);
    }
    this.idempotency.set(key, copy(record));
  }
}
