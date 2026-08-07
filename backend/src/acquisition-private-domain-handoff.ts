import { createHash } from "node:crypto";
import type {
  AcquisitionDomainRepository
} from "./acquisition-domain-repository.js";
import type {
  AcquisitionActorScope,
  AcquisitionDomainService
} from "./acquisition-domain-service.js";
import { canonicalJsonStringify } from "./canonical-json.js";
import type {
  AcquisitionCustomerHandoff,
  AcquisitionCustomerHandoffOperation,
  AcquisitionHandoffIntelligence,
  Customer,
  CustomerActivity,
  Lead,
  LeadActivity,
  LeadSourceEvent,
  Todo
} from "./types.js";

export interface AcquisitionPrivateDomainHandoffRequest {
  operationCode: "handoff_acquisition_candidate_v1";
  decisionVersion: string;
  mode: "create_new" | "link_existing";
  existingCustomerId: string;
  followUp: {
    title: string;
    dueAt: string;
    priority: "high" | "medium" | "normal";
  };
}

export interface AcquisitionPrivateDomainHandoffStore {
  leads: Lead[];
  leadSourceEvents: LeadSourceEvent[];
  leadActivities: LeadActivity[];
  customers: Customer[];
  customerActivities: CustomerActivity[];
  todos: Todo[];
  acquisitionCustomerHandoffs: AcquisitionCustomerHandoff[];
  acquisitionCustomerHandoffOperations: AcquisitionCustomerHandoffOperation[];
  persist(): Promise<void>;
  persistMutation?<T>(mutation: () => {
    value: T;
    rollback(): void;
  }): Promise<T>;
  readBarrier(): Promise<void>;
}

export interface AcquisitionPrivateDomainHandoffResult {
  replayed: boolean;
  handoff: AcquisitionCustomerHandoff;
  lead: Lead;
  customer: Customer;
  todo: Todo;
  intelligence: AcquisitionHandoffIntelligence;
}

export class AcquisitionPrivateDomainHandoffError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "AcquisitionPrivateDomainHandoffError";
  }
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableId(prefix: string, values: string[]) {
  return `${prefix}_${digest(values.join("\u001f")).slice(0, 40)}`;
}

function gradeForCustomer(
  grade: AcquisitionHandoffIntelligence["qualificationGrade"]
): Customer["grade"] {
  return grade === "S" ? "A" : grade;
}

function removeById<T extends { id: string }>(values: T[], id: string) {
  const index = values.findIndex((value) => value.id === id);
  if (index >= 0) values.splice(index, 1);
}

const handoffStageOrder: AcquisitionCustomerHandoffOperation["stage"][] = [
  "reserved",
  "lead_ready",
  "customer_ready",
  "activity_ready",
  "todo_ready",
  "completed"
];

function laterHandoffStage(
  current: AcquisitionCustomerHandoffOperation["stage"],
  next: AcquisitionCustomerHandoffOperation["stage"]
) {
  return handoffStageOrder.indexOf(current) >= handoffStageOrder.indexOf(next)
    ? current
    : next;
}

export class AcquisitionPrivateDomainHandoffService {
  readonly #repository: AcquisitionDomainRepository;
  readonly #domainService: AcquisitionDomainService;
  readonly #store: AcquisitionPrivateDomainHandoffStore;
  readonly #now: () => string;
  readonly #inFlight = new Map<
    string,
    Promise<AcquisitionPrivateDomainHandoffResult>
  >();

  constructor(options: {
    repository: AcquisitionDomainRepository;
    domainService: AcquisitionDomainService;
    store: AcquisitionPrivateDomainHandoffStore;
    now?: () => string;
  }) {
    this.#repository = options.repository;
    this.#domainService = options.domainService;
    this.#store = options.store;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async create(
    scope: AcquisitionActorScope,
    candidateId: string,
    request: AcquisitionPrivateDomainHandoffRequest,
    idempotencyKey: string
  ): Promise<AcquisitionPrivateDomainHandoffResult> {
    const flightKey = [scope.ownerId, scope.teamId, candidateId].join("\u001f");
    const running = this.#inFlight.get(flightKey);
    if (running) {
      await running;
      return await this.#create(scope, candidateId, request, idempotencyKey);
    }
    const operation = this.#create(
      scope,
      candidateId,
      request,
      idempotencyKey
    );
    this.#inFlight.set(flightKey, operation);
    try {
      return await operation;
    } finally {
      if (this.#inFlight.get(flightKey) === operation) {
        this.#inFlight.delete(flightKey);
      }
    }
  }

  async #create(
    scope: AcquisitionActorScope,
    candidateId: string,
    request: AcquisitionPrivateDomainHandoffRequest,
    idempotencyKey: string
  ): Promise<AcquisitionPrivateDomainHandoffResult> {
    await this.#store.readBarrier();
    const processingKeyHash = digest([
      scope.ownerId,
      scope.teamId,
      candidateId,
      idempotencyKey
    ].join("\u001f"));
    const requestHash = digest(canonicalJsonStringify(request));
    const completed = this.#store.acquisitionCustomerHandoffs.find((item) =>
      item.ownerId === scope.ownerId
      && item.teamId === scope.teamId
      && item.candidateId === candidateId
    );
    if (completed) {
      if (completed.processingKeyHash === processingKeyHash
        && completed.requestHash !== requestHash) {
        throw new AcquisitionPrivateDomainHandoffError(
          "ACQUISITION_HANDOFF_IDEMPOTENCY_CONFLICT",
          "同一 Idempotency-Key 已用于不同交接请求",
          409
        );
      }
      return this.#completedResult(
        scope,
        completed,
        completed.processingKeyHash === processingKeyHash
      );
    }
    let operation = this.#store.acquisitionCustomerHandoffOperations.find(
      (item) => item.ownerId === scope.ownerId
        && item.teamId === scope.teamId
        && item.candidateId === candidateId
    );
    if (operation?.processingKeyHash === processingKeyHash
      && operation.requestHash !== requestHash) {
      throw new AcquisitionPrivateDomainHandoffError(
        "ACQUISITION_HANDOFF_IDEMPOTENCY_CONFLICT",
        "同一 Idempotency-Key 已用于不同交接请求",
        409
      );
    }
    if (operation && operation.processingKeyHash !== processingKeyHash) {
      throw new AcquisitionPrivateDomainHandoffError(
        "ACQUISITION_HANDOFF_ALREADY_IN_PROGRESS",
        "候选已有未完成的 CRM/私域交接",
        409
      );
    }
    const candidate = await this.#repository.findCandidate(scope, candidateId);
    if (!candidate) {
      throw new AcquisitionPrivateDomainHandoffError(
        "ACQUISITION_CANDIDATE_NOT_FOUND",
        "候选不存在",
        404
      );
    }
    if (candidate.status !== "approved"
      && candidate.status !== "converted_to_lead") {
      throw new AcquisitionPrivateDomainHandoffError(
        "ACQUISITION_HANDOFF_NOT_APPROVED",
        "只有已批准或已转线索的候选可以交接",
        409
      );
    }
    if (candidate.approvedDecisionVersion !== request.decisionVersion
      || candidate.latestDecisionVersion !== request.decisionVersion) {
      throw new AcquisitionPrivateDomainHandoffError(
        "ACQUISITION_HANDOFF_STALE_DECISION",
        "审核批准的资格决定版本已失效",
        409
      );
    }
    if (candidate.hardGateFailures.length > 0) {
      throw new AcquisitionPrivateDomainHandoffError(
        "ACQUISITION_HANDOFF_HARD_GATE_BLOCKED",
        "硬门禁未通过，禁止交接",
        409
      );
    }
    const qualifications = await this.#repository.listQualificationDecisions(
      scope,
      candidateId
    );
    const qualification = qualifications.find((item) =>
      item.id === candidate.latestDecisionId
      && item.decisionVersion === request.decisionVersion
    );
    const financials = await this.#repository.listFinancialValues(
      scope,
      candidateId
    );
    const financial = financials
      .filter((item) =>
        item.qualificationDecisionId === qualification?.id
      )
      .at(-1);
    if (!qualification || !financial) {
      throw new AcquisitionPrivateDomainHandoffError(
        "ACQUISITION_HANDOFF_INTELLIGENCE_MISSING",
        "候选的服务端评分快照不完整",
        409
      );
    }
    if (qualification.hardGateFailures.length > 0) {
      throw new AcquisitionPrivateDomainHandoffError(
        "ACQUISITION_HANDOFF_HARD_GATE_BLOCKED",
        "服务端资格快照的硬门禁未通过",
        409
      );
    }
    const existingCustomer = request.mode === "link_existing"
      ? this.#store.customers.find((item) =>
          item.id === request.existingCustomerId
          && item.ownerId === scope.ownerId
          && item.teamId === scope.teamId
        )
      : undefined;
    if (request.mode === "link_existing" && !existingCustomer) {
      throw new AcquisitionPrivateDomainHandoffError(
        "ACQUISITION_HANDOFF_CUSTOMER_NOT_FOUND",
        "指定的客户不存在或不在当前负责人/团队范围",
        404
      );
    }
    const currentIntelligence: AcquisitionHandoffIntelligence = {
      qualificationGrade: qualification.grade,
      qualificationScore: qualification.score,
      financialGrade: financial.grade,
      currency: financial.currency,
      expectedRevenueMinor: financial.expectedRevenueMinor,
      expectedGrossProfitMinor: financial.expectedGrossProfitMinor,
      expectedContributionMinor: financial.expectedContributionMinor
    };
    const identity = [scope.ownerId, scope.teamId, candidateId];
    const createdAt = operation?.createdAt
      ?? new Date(this.#now()).toISOString();
    if (!operation) {
      operation = {
        id: stableId("acho", identity),
        ownerId: scope.ownerId,
        teamId: scope.teamId,
        candidateId,
        processingKeyHash,
        requestHash,
        decisionVersion: request.decisionVersion,
        mode: request.mode,
        existingCustomerId: request.existingCustomerId,
        stage: "reserved",
        leadId: candidate.leadId ?? "",
        customerId: existingCustomer?.id ?? stableId("customer", identity),
        activityId: stableId("ca", identity),
        todoId: stableId("todo", identity),
        handoffId: stableId("ach", identity),
        intelligence: currentIntelligence,
        qualificationSnapshotHash: qualification.snapshotHash,
        financialSnapshotHash: financial.inputSnapshotHash,
        createdAt,
        updatedAt: createdAt
      };
      const reserved = operation;
      await this.#persistMutation(() => {
        this.#store.acquisitionCustomerHandoffOperations.unshift(reserved);
        return {
          value: undefined,
          rollback: () => removeById(
            this.#store.acquisitionCustomerHandoffOperations,
            reserved.id
          )
        };
      });
    }
    const conversion = candidate.status === "converted_to_lead"
      && candidate.leadId
      ? { leadId: candidate.leadId }
      : await this.#domainService.convertCandidate(scope, candidateId, {
          decisionVersion: request.decisionVersion,
          idempotencyKey: `private-domain-handoff:${idempotencyKey}`
        });
    const lead = this.#store.leads.find((item) =>
      item.id === conversion.leadId
      && item.ownerId === scope.ownerId
      && item.teamId === scope.teamId
    );
    if (!lead) {
      throw new AcquisitionPrivateDomainHandoffError(
        "ACQUISITION_HANDOFF_LEAD_MISSING",
        "CRM 线索未完整持久化",
        502
      );
    }
    const intelligence = structuredClone(operation.intelligence);
    const linkedCustomerId = lead.convertedCustomerId?.trim() ?? "";
    const linkedCustomer = linkedCustomerId
      ? this.#store.customers.find((item) =>
          item.id === linkedCustomerId
          && item.ownerId === scope.ownerId
          && item.teamId === scope.teamId
        )
      : undefined;
    if (linkedCustomerId && !linkedCustomer) {
      throw new AcquisitionPrivateDomainHandoffError(
        "ACQUISITION_HANDOFF_LEAD_CUSTOMER_MISSING",
        "CRM 线索已关联的客户不存在或不在当前租户范围",
        409
      );
    }
    if (linkedCustomer && existingCustomer
      && linkedCustomer.id !== existingCustomer.id) {
      throw new AcquisitionPrivateDomainHandoffError(
        "ACQUISITION_HANDOFF_LEAD_CUSTOMER_CONFLICT",
        "CRM 线索已关联其他客户，不能覆盖原客户链接",
        409
      );
    }
    const customerId = linkedCustomer?.id
      ?? existingCustomer?.id
      ?? operation.customerId;
    const snapshotEventId = stableId("lse", [
      ...identity,
      "private-domain-handoff-snapshot"
    ]);
    const recoveredSnapshotEvent = this.#store.leadSourceEvents.find((item) =>
      item.id === snapshotEventId
      && item.leadId === lead.id
      && item.ownerId === scope.ownerId
      && item.teamId === scope.teamId
    );
    const snapshotEvent: LeadSourceEvent = {
      id: snapshotEventId,
      leadId: lead.id,
      sourceType: "outbound",
      channel: "acquisition_private_domain_handoff_snapshot",
      campaign: request.decisionVersion,
      externalId: candidateId,
      sourceUrl: lead.sourceUrl,
      occurredAt: createdAt,
      receivedAt: createdAt,
      rawPayload: canonicalJsonStringify({
        candidateId,
        decisionVersion: request.decisionVersion,
        intelligence,
        qualificationSnapshotHash: operation.qualificationSnapshotHash,
        financialSnapshotHash: operation.financialSnapshotHash
      }),
      ownerId: scope.ownerId,
      teamId: scope.teamId
    };
    await this.#persistMutation(() => {
      const previousOperation = structuredClone(operation);
      if (!recoveredSnapshotEvent) {
        this.#store.leadSourceEvents.unshift(snapshotEvent);
      }
      Object.assign(operation, {
        stage: laterHandoffStage(operation.stage, "lead_ready"),
        leadId: lead.id,
        customerId,
        updatedAt: new Date(this.#now()).toISOString()
      });
      return {
        value: undefined,
        rollback: () => {
          if (!recoveredSnapshotEvent) {
            removeById(this.#store.leadSourceEvents, snapshotEvent.id);
          }
          Object.assign(operation, previousOperation);
        }
      };
    });
    const activityId = operation.activityId;
    const todoId = operation.todoId;
    const handoffId = operation.handoffId;
    const recoveredCustomer = this.#store.customers.find((item) =>
      item.id === customerId
      && item.ownerId === scope.ownerId
      && item.teamId === scope.teamId
    );
    const targetCustomer = linkedCustomer ?? existingCustomer
      ?? recoveredCustomer;
    const customer: Customer = targetCustomer
      ? {
          ...targetCustomer,
          nextReminder: request.followUp.dueAt
        }
      : {
          id: customerId,
          company: lead.company,
          country: lead.country,
          contact: lead.contact,
          ownerId: scope.ownerId,
          teamId: scope.teamId,
          stage: "待首次跟进",
          amount: intelligence.currency === "CNY"
            ? intelligence.expectedRevenueMinor / 100
            : 0,
          health: 80,
          grade: gradeForCustomer(intelligence.qualificationGrade),
          nextReminder: request.followUp.dueAt,
          wecomBound: false,
          billingName: "",
          billingAddress: "",
          documentContact: lead.contact,
          defaultPortDischarge: "",
          defaultIncoterm: "",
          defaultPaymentTerm: "",
          poolStatus: "owned",
          ownershipVersion: 0
        };
    await this.#persistMutation(() => {
      const previousCustomer = targetCustomer
        ? structuredClone(targetCustomer)
        : null;
      const previousConvertedCustomerId = lead.convertedCustomerId;
      const previousOperation = structuredClone(operation);
      if (targetCustomer) {
        targetCustomer.nextReminder = customer.nextReminder;
      } else {
        this.#store.customers.unshift(customer);
      }
      lead.convertedCustomerId = customer.id;
      Object.assign(operation, {
        stage: laterHandoffStage(operation.stage, "customer_ready"),
        customerId: customer.id,
        updatedAt: new Date(this.#now()).toISOString()
      });
      return {
        value: undefined,
        rollback: () => {
          if (targetCustomer && previousCustomer) {
            Object.assign(targetCustomer, previousCustomer);
          } else {
            removeById(this.#store.customers, customer.id);
          }
          lead.convertedCustomerId = previousConvertedCustomerId;
          Object.assign(operation, previousOperation);
        }
      };
    });
    const activity: CustomerActivity = {
      id: activityId,
      customerId,
      type: "note",
      content: `由获客候选 ${candidateId} 交接至 CRM/私域，已创建首次跟进。`,
      operatorId: scope.actorId,
      nextReminder: request.followUp.dueAt,
      createdAt
    };
    const recoveredActivity = this.#store.customerActivities.find((item) =>
      item.id === activityId
    );
    await this.#persistMutation(() => {
      const previousOperation = structuredClone(operation);
      if (!recoveredActivity) this.#store.customerActivities.unshift(activity);
      Object.assign(operation, {
        stage: laterHandoffStage(operation.stage, "activity_ready"),
        updatedAt: new Date(this.#now()).toISOString()
      });
      return {
        value: undefined,
        rollback: () => {
          if (!recoveredActivity) {
            removeById(this.#store.customerActivities, activity.id);
          }
          Object.assign(operation, previousOperation);
        }
      };
    });
    const todo: Todo = {
      id: todoId,
      title: request.followUp.title,
      type: "customer",
      priority: request.followUp.priority,
      status: "pending",
      dueAt: request.followUp.dueAt,
      ownerId: scope.ownerId,
      teamId: scope.teamId,
      related: customer.company,
      done: false,
      customerId,
      leadId: lead.id,
      triggerKey: `acquisition-first-follow-up:${candidateId}`,
      createdAt
    };
    const recoveredTodo = this.#store.todos.find((item) =>
      item.id === todoId
      && item.ownerId === scope.ownerId
      && item.teamId === scope.teamId
    );
    await this.#persistMutation(() => {
      const previousOperation = structuredClone(operation);
      if (!recoveredTodo) this.#store.todos.unshift(todo);
      Object.assign(operation, {
        stage: laterHandoffStage(operation.stage, "todo_ready"),
        updatedAt: new Date(this.#now()).toISOString()
      });
      return {
        value: undefined,
        rollback: () => {
          if (!recoveredTodo) removeById(this.#store.todos, todo.id);
          Object.assign(operation, previousOperation);
        }
      };
    });
    const durableTodo = recoveredTodo ?? todo;
    const handoff: AcquisitionCustomerHandoff = {
      id: handoffId,
      ownerId: scope.ownerId,
      teamId: scope.teamId,
      candidateId,
      leadId: lead.id,
      customerId,
      todoId,
      decisionVersion: request.decisionVersion,
      mode: request.mode,
      processingKeyHash,
      requestHash,
      intelligence,
      qualificationSnapshotHash: operation.qualificationSnapshotHash,
      financialSnapshotHash: operation.financialSnapshotHash,
      createdAt
    };
    const result: AcquisitionPrivateDomainHandoffResult = {
      replayed: false,
      handoff,
      lead,
      customer,
      todo: durableTodo,
      intelligence
    };
    const apply = () => {
      const previousOperation = structuredClone(operation);
      this.#store.acquisitionCustomerHandoffs.unshift(handoff);
      Object.assign(operation, {
        stage: "completed",
        leadId: lead.id,
        customerId: customer.id,
        updatedAt: createdAt
      });
      return {
        value: result,
        rollback: () => {
          removeById(this.#store.acquisitionCustomerHandoffs, handoff.id);
          Object.assign(operation, previousOperation);
        }
      };
    };
    return await this.#persistMutation(apply);
  }

  async #persistMutation<T>(mutationFactory: () => {
    value: T;
    rollback(): void;
  }): Promise<T> {
    if (this.#store.persistMutation) {
      return await this.#store.persistMutation(mutationFactory);
    }
    const mutation = mutationFactory();
    try {
      await this.#store.persist();
      return mutation.value;
    } catch (error) {
      mutation.rollback();
      throw error;
    }
  }

  #completedResult(
    scope: Pick<AcquisitionActorScope, "ownerId" | "teamId">,
    handoff: AcquisitionCustomerHandoff,
    replayed: boolean
  ): AcquisitionPrivateDomainHandoffResult {
    const lead = this.#store.leads.find((item) =>
      item.id === handoff.leadId
      && item.ownerId === scope.ownerId
      && item.teamId === scope.teamId
    );
    const customer = this.#store.customers.find((item) =>
      item.id === handoff.customerId
      && item.ownerId === scope.ownerId
      && item.teamId === scope.teamId
    );
    const todo = this.#store.todos.find((item) =>
      item.id === handoff.todoId
      && item.ownerId === scope.ownerId
      && item.teamId === scope.teamId
    );
    if (!lead || !customer || !todo) {
      throw new AcquisitionPrivateDomainHandoffError(
        "ACQUISITION_HANDOFF_INCOMPLETE",
        "交接记录关联的 CRM 资源不完整",
        502
      );
    }
    return {
      replayed,
      handoff,
      lead,
      customer,
      todo,
      intelligence: handoff.intelligence
    };
  }

  async get(
    scope: Pick<AcquisitionActorScope, "ownerId" | "teamId">,
    candidateId: string
  ): Promise<AcquisitionPrivateDomainHandoffResult> {
    await this.#store.readBarrier();
    const handoff = this.#store.acquisitionCustomerHandoffs.find((item) =>
      item.ownerId === scope.ownerId
      && item.teamId === scope.teamId
      && item.candidateId === candidateId
    );
    if (!handoff) {
      throw new AcquisitionPrivateDomainHandoffError(
        "ACQUISITION_HANDOFF_NOT_FOUND",
        "交接记录不存在",
        404
      );
    }
    return this.#completedResult(scope, handoff, false);
  }
}
