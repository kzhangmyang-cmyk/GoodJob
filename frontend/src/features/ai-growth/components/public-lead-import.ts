import {
  componentRender,
  escapeHtml,
  type ComponentRender
} from "./rendering.js";

export type PublicLeadImportUrlStatus =
  | "idle"
  | "uploading"
  | "completed"
  | "partial"
  | "failed";

export type PublicLeadImportItemStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "access_restricted"
  | "failed";

export interface PublicLeadImportUrlResultVm {
  sourceUrl: string;
  status: PublicLeadImportItemStatus;
  operationId: string | null;
  evidenceCount: number | null;
  errorMessage: string | null;
}

export type PublicLeadImportFileStatus =
  | "idle"
  | "ready"
  | "uploading"
  | "accepted"
  | "failed";

export interface PublicLeadImportFileVm {
  name: string;
  size: number;
}

export interface PublicLeadImportOutcomeVm {
  acceptedRowCount: number | null;
  evidenceCount: number | null;
  candidateCount: number | null;
  candidateIds: string[];
  rowErrors: PublicLeadImportRowErrorVm[];
}

export interface PublicLeadImportRowErrorVm {
  sheetName: string;
  rowNumber: number;
  code: string;
  message: string;
}

export interface PublicLeadImportVm {
  urlText: string;
  urlStatus: PublicLeadImportUrlStatus;
  urlResults: readonly PublicLeadImportUrlResultVm[];
  file: PublicLeadImportFileVm | null;
  fileStatus: PublicLeadImportFileStatus;
  fileOperationId: string | null;
  urlOutcome?: PublicLeadImportOutcomeVm | null;
  fileOutcome?: PublicLeadImportOutcomeVm | null;
  message: string | null;
}

export interface PublicLeadImportCallbacks {
  onUrlTextChange(value: string): void;
  onSubmitUrls(): void;
  onFileSelect(file: File | null): void;
  onSubmitFile(): void;
}

const URL_STATUS_LABELS: Readonly<Record<
  PublicLeadImportItemStatus,
  string
>> = {
  queued: "等待导入",
  running: "正在形成证据",
  succeeded: "用户提交证据已形成",
  access_restricted: "访问受限",
  failed: "导入失败"
};

function fileSizeLabel(size: number): string {
  if (size < 1_024) return `${size} B`;
  if (size < 1_024 * 1_024) return `${(size / 1_024).toFixed(1)} KB`;
  return `${(size / (1_024 * 1_024)).toFixed(1)} MB`;
}

function urlResults(vm: PublicLeadImportVm): string {
  if (vm.urlResults.length === 0) return "";
  return `
    <ol class="ai-growth-import-results" aria-label="公开链接导入结果">
      ${vm.urlResults.map((result) => `
        <li data-import-result-status="${result.status}">
          <span>
            <strong>${escapeHtml(URL_STATUS_LABELS[result.status])}</strong>
            <small>${escapeHtml(result.sourceUrl)}</small>
          </span>
          <span>
            ${result.evidenceCount === null
              ? ""
              : `${result.evidenceCount} 条证据`}
            ${result.operationId
              ? `<small>任务 ${escapeHtml(result.operationId)}</small>`
              : ""}
            ${result.errorMessage
              ? `<small class="ai-growth-import-error">${escapeHtml(result.errorMessage)}</small>`
              : ""}
          </span>
        </li>
      `).join("")}
    </ol>
  `;
}

function outcomeHtml(
  outcome: PublicLeadImportOutcomeVm | null | undefined
): string {
  if (!outcome) return "";
  const metrics = [
    outcome.acceptedRowCount === null
      ? null
      : `接收 ${outcome.acceptedRowCount} 行`,
    outcome.evidenceCount === null
      ? null
      : `形成 ${outcome.evidenceCount} 条证据`,
    outcome.candidateCount === null
      ? null
      : `生成 ${outcome.candidateCount} 个待核验候选`
  ].filter((item): item is string => item !== null);
  const candidateLinks = outcome.candidateIds.map((candidateId, index) => `
    <button
      type="button"
      class="ai-growth-text-action"
      data-action="verify-identity"
      data-candidate-id="${escapeHtml(candidateId)}"
    >打开待核验候选 ${index + 1}</button>
  `).join("");
  const rowErrors = outcome.rowErrors.map((error) => `
    <li>
      <strong>第 ${error.rowNumber} 行${error.sheetName
        ? ` · ${escapeHtml(error.sheetName)}`
        : ""}</strong>
      <span>${escapeHtml(error.message)}</span>
      <small>${escapeHtml(error.code)}</small>
    </li>
  `).join("");
  return `
    <section class="ai-growth-import-outcome" aria-label="导入结果">
      ${metrics.length > 0 ? `<p>${metrics.map(escapeHtml).join(" · ")}</p>` : ""}
      ${candidateLinks ? `<div>${candidateLinks}</div>` : ""}
      ${rowErrors
        ? `<ul class="ai-growth-import-row-errors" aria-label="逐行导入错误">${rowErrors}</ul>`
        : ""}
    </section>
  `;
}

export function renderPublicLeadImport(
  vm: PublicLeadImportVm,
  callbacks: PublicLeadImportCallbacks
): ComponentRender<PublicLeadImportCallbacks> {
  const urlsBusy = vm.urlStatus === "uploading";
  const fileBusy = vm.fileStatus === "uploading";
  const fileLabel = vm.file
    ? `${escapeHtml(vm.file.name)} · ${fileSizeLabel(vm.file.size)}`
    : "尚未选择文件";
  const fileStatus = vm.fileStatus === "accepted"
    ? `导入完成${vm.fileOperationId
      ? ` · ${escapeHtml(vm.fileOperationId)}`
      : ""}`
    : vm.fileStatus === "uploading"
      ? "正在导入并形成用户提交证据，主体仍待核验"
      : vm.fileStatus === "failed"
        ? vm.message ?? "文件导入失败"
        : "标准列：标题、摘要；可选列：平台、链接、发布时间、语言";

  return componentRender(`
    <section class="ai-growth-public-import" aria-labelledby="aiGrowthPublicImportTitle">
      <header class="ai-growth-public-import__header">
        <div>
          <p class="ai-growth-eyebrow">02 · 已有公开线索</p>
          <h2 id="aiGrowthPublicImportTitle">导入公开抖音线索</h2>
          <p>粘贴抖音公开页面，或上传团队已整理的 CSV / XLSX。</p>
        </div>
        <span class="ai-growth-public-import__boundary">仅支持公开页面</span>
      </header>
      <div class="ai-growth-public-import__notice" role="note">
        导入后先形成用户提交证据；系统可识别待核验主体，不会自动认定主体或意向。
      </div>
      ${vm.message
        ? `<p class="ai-growth-public-import__message" role="status" aria-live="polite">${escapeHtml(vm.message)}</p>`
        : ""}
      <div class="ai-growth-public-import__grid">
        <section class="ai-growth-public-import__method">
          <div>
            <span class="ai-growth-character-icon" aria-hidden="true">链</span>
            <h3>粘贴公开链接</h3>
          </div>
          <label>
            <span>每行一个 HTTPS 链接</span>
            <textarea
              rows="5"
              data-field="public-import-urls"
              placeholder="https://www.douyin.com/video/...&#10;https://v.douyin.com/..."
              ${urlsBusy ? "disabled" : ""}
            >${escapeHtml(vm.urlText)}</textarea>
          </label>
          <button
            type="button"
            class="ai-growth-button ai-growth-button--primary"
            data-action="submit-public-import-urls"
            ${urlsBusy || vm.urlText.trim().length === 0 ? "disabled" : ""}
          >${urlsBusy ? "正在导入" : "导入公开链接"}</button>
          ${urlResults(vm)}
          ${outcomeHtml(vm.urlOutcome)}
        </section>
        <section class="ai-growth-public-import__method">
          <div>
            <span class="ai-growth-character-icon" aria-hidden="true">表</span>
            <h3>上传 CSV / XLSX</h3>
          </div>
          <label class="ai-growth-public-import__file">
            <span>选择文件</span>
            <input
              type="file"
              data-field="public-import-file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              ${fileBusy ? "disabled" : ""}
            >
            <strong>${fileLabel}</strong>
          </label>
          <p class="ai-growth-public-import__status" data-file-status="${vm.fileStatus}">${escapeHtml(fileStatus)}</p>
          ${outcomeHtml(vm.fileOutcome)}
          <button
            type="button"
            class="ai-growth-button ai-growth-button--secondary"
            data-action="submit-public-import-file"
            ${fileBusy || vm.file === null ? "disabled" : ""}
          >${fileBusy ? "正在上传" : "上传并导入"}</button>
        </section>
      </div>
    </section>
  `, callbacks);
}
