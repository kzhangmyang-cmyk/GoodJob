import type {
  AdvisorMode,
  CandidateCardVm,
  CandidateStatus
} from "../types.js";
import {
  componentRender,
  escapeHtml,
  percent,
  visibleList,
  type ComponentRender
} from "./rendering.js";

export interface CandidateListVm {
  mode: AdvisorMode;
  candidates: readonly CandidateCardVm[];
}

export interface CandidateListCallbacks {
  onOpenBattleCard(candidateId: string): void;
  onApprove(candidateId: string): void;
  onReject(candidateId: string): void;
  onDoNotContact(candidateId: string): void;
  onRequestResearch(candidateId: string): void;
  onReopen(candidateId: string): void;
  onConvert(candidateId: string): void;
}

interface ReviewPresentation {
  label: string;
  tone: string;
  guidance: string;
}

const REVIEW_PRESENTATION: Readonly<Record<CandidateStatus, ReviewPresentation>> = {
  discovered: {
    label: "待整理",
    tone: "neutral",
    guidance: "等待主体整理完成"
  },
  unresolvable: {
    label: "主体待核实",
    tone: "warning",
    guidance: "查看证据并补充主体信息"
  },
  normalized: {
    label: "待资格判断",
    tone: "neutral",
    guidance: "等待意向评分完成"
  },
  qualified: {
    label: "待人工审核",
    tone: "review",
    guidance: "先完成人工审核"
  },
  pending_review: {
    label: "待人工审核",
    tone: "review",
    guidance: "先完成人工审核"
  },
  approved: {
    label: "已批准",
    tone: "success",
    guidance: "可转为线索"
  },
  rejected: {
    label: "已拒绝",
    tone: "danger",
    guidance: "可重新打开后再评估"
  },
  do_not_contact: {
    label: "勿扰",
    tone: "danger",
    guidance: "仅查看依据，不执行触达"
  },
  needs_research: {
    label: "需补充研究",
    tone: "warning",
    guidance: "补充公开证据后再审核"
  },
  converted_to_lead: {
    label: "已转为线索",
    tone: "success",
    guidance: "进入 CRM 跟进阶段"
  }
};

function finance(candidate: CandidateCardVm): string {
  if (candidate.financialValue.status === "pending") {
    return `<span class="ai-growth-finance is-pending"><b>财务价值</b><strong>待评估</strong></span>`;
  }
  return `
    <span class="ai-growth-finance is-evaluated">
      <b>预计收入</b>
      <strong>${candidate.financialValue.amounts.map((amount) =>
        `<span>${escapeHtml(amount.currency)} ${escapeHtml(amount.formatted)}</span>`
      ).join("")}</strong>
    </span>
  `;
}

function reviewActions(candidate: CandidateCardVm, mode: AdvisorMode): string {
  const id = escapeHtml(candidate.id);
  const common = `
    <button type="button" class="ai-growth-text-action" data-action="open-battle-card" data-candidate-id="${id}">查看客户作战卡</button>
  `;
  if (mode === "demo") {
    return `${common}<button type="button" class="ai-growth-text-action" data-action="preview-review" data-candidate-id="${id}">预览人工审核</button>`;
  }
  switch (candidate.status) {
    case "qualified":
    case "pending_review":
      return `${common}
        <button type="button" class="ai-growth-text-action" data-action="approve" data-candidate-id="${id}">批准</button>
        <button type="button" class="ai-growth-text-action" data-action="request-research" data-candidate-id="${id}">补充研究</button>
        <button type="button" class="ai-growth-text-action" data-action="reject" data-candidate-id="${id}">拒绝</button>
        <button type="button" class="ai-growth-text-action is-danger" data-action="do-not-contact" data-candidate-id="${id}">设为勿扰</button>
      `;
    case "approved":
      return `${common}<button type="button" class="ai-growth-button ai-growth-button--primary ai-growth-button--compact" data-action="convert" data-candidate-id="${id}">转为线索</button>`;
    case "rejected":
      return `${common}<button type="button" class="ai-growth-text-action" data-action="reopen" data-candidate-id="${id}">重新打开</button>`;
    case "needs_research":
      return `${common}<button type="button" class="ai-growth-text-action" data-action="request-research" data-candidate-id="${id}">补充研究</button><button type="button" class="ai-growth-text-action" data-action="reopen" data-candidate-id="${id}">重新打开</button>`;
    case "do_not_contact":
      return `${common}<button type="button" class="ai-growth-text-action" data-action="reopen" data-candidate-id="${id}">重新打开</button>`;
    default:
      return common;
  }
}

function candidateCard(candidate: CandidateCardVm, mode: AdvisorMode): string {
  const review = REVIEW_PRESENTATION[candidate.status];
  const qualification = candidate.qualification;
  const signals = qualification?.positiveSignals.map((signal) => signal.name) ?? [];
  const reason = qualification?.reasons[0] ?? "等待更多公开证据";
  const grade = qualification?.grade ?? "待评分";
  const confidence = qualification === null
    ? "置信度待评估"
    : `置信度 ${percent(qualification.confidence)}`;

  return `
    <article class="ai-growth-candidate-card" data-candidate-id="${escapeHtml(candidate.id)}" data-review-status="${candidate.status}">
      <header>
        <span class="ai-growth-character-icon" aria-hidden="true">企</span>
        <div>
          <h3>${escapeHtml(candidate.displayName)}</h3>
          <p>${escapeHtml(candidate.industry ?? "行业待核实")} · ${escapeHtml(candidate.region ?? "地区待核实")}</p>
        </div>
        <span class="ai-growth-review-label" data-tone="${review.tone}">${review.label}</span>
      </header>
      <div class="ai-growth-candidate-signal">
        <span>需求信号</span>
        <strong>${escapeHtml(reason)}</strong>
        <div class="ai-growth-chip-list">${visibleList(signals, "等待信号提取")}</div>
      </div>
      <div class="ai-growth-candidate-evidence">
        <span><b>${candidate.sourcePlatforms.length} 个来源</b>${escapeHtml(candidate.sourcePlatforms.join("、") || "来源待补充")}</span>
        <span><b>${candidate.evidenceCount} 条证据</b>${confidence}</span>
      </div>
      <div class="ai-growth-candidate-score">
        <span class="ai-growth-grade" data-grade="${grade}"><small>意向等级</small><strong>${grade}</strong></span>
        ${finance(candidate)}
      </div>
      <footer>
        <span class="ai-growth-review-guidance">${review.guidance}</span>
        <div class="ai-growth-candidate-actions">${reviewActions(candidate, mode)}</div>
      </footer>
    </article>
  `;
}

export function renderCandidateList(
  vm: CandidateListVm,
  callbacks: CandidateListCallbacks
): ComponentRender<CandidateListCallbacks> {
  const cards = vm.candidates.length === 0
    ? `
      <div class="ai-growth-candidate-empty">
        <span class="ai-growth-character-icon ai-growth-character-icon--large" aria-hidden="true">候</span>
        <h3>候选客户尚未出现</h3>
        <p>执行开始后，公开证据通过整理与去重的候选会显示在这里。</p>
      </div>
    `
    : vm.candidates.map((value) => candidateCard(value, vm.mode)).join("");
  return componentRender(`
    <section class="ai-growth-candidate-list" aria-labelledby="aiGrowthCandidatesTitle">
      <div class="ai-growth-list-heading">
        <div>
          <p class="ai-growth-eyebrow">优先客户</p>
          <h2 id="aiGrowthCandidatesTitle">今天最值得跟进的客户</h2>
        </div>
        <span>${vm.candidates.length} 个候选</span>
      </div>
      <div class="ai-growth-candidate-stack">${cards}</div>
    </section>
  `, callbacks);
}
