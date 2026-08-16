import type { VisualOcrResult } from "./ocr-port";
import type { OpaqueRectRedactionProofV1, PixelRect } from "./visual-pipeline";
import type { VisualCaptureRequest } from "./visual-capture-guard";

export interface VisualCaptureEvidence {
  mediaType: "image/webp";
  contentBase64: string;
  width: number;
  height: number;
  redactionProof: OpaqueRectRedactionProofV1;
  ocrResult: VisualOcrResult;
}

export type VisualProcessCaptureMessage = Omit<VisualCaptureRequest, "kind"> & {
  kind: "visual_process_capture";
  screenshotDataUrl: string;
};

export interface VisualCaptureRuntimeDependencies {
  authorize(request: unknown, senderTabId: number | null): Promise<VisualCaptureRequest | null>;
  ensureOffscreen(): Promise<void>;
  reserveOcrCall(request: VisualCaptureRequest): Promise<boolean>;
  captureVisibleTab(request: VisualCaptureRequest): Promise<string>;
  processOffscreen(message: VisualProcessCaptureMessage): Promise<unknown>;
  endOffscreenSession(): Promise<boolean>;
}

function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!record(value)) return false;
  const actual = Object.keys(value);
  const allowed = new Set(keys);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
    && actual.every((key) => allowed.has(key));
}

function integer(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function finite(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function rect(value: unknown, width: number, height: number): value is PixelRect {
  return exact(value, ["x", "y", "width", "height"])
    && integer(value.x, 0, width - 1) && integer(value.y, 0, height - 1)
    && integer(value.width, 1, width) && integer(value.height, 1, height)
    && (value.x as number) + (value.width as number) <= width
    && (value.y as number) + (value.height as number) <= height;
}

function canonicalWebpBase64(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 349_528
    && value.startsWith("UklGR") && value.length % 4 === 0
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/][AQgw]==|[A-Za-z0-9+/]{2}[AEIMQUYcgkosw048]=)?$/u.test(value)
    && Math.floor(value.length * 3 / 4) - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0)
      <= 262_144;
}

function ocrResult(value: unknown, width: number, height: number): value is VisualOcrResult {
  if (!exact(value, ["text", "confidence", "words"])
    || typeof value.text !== "string" || value.text.length > 2_000
    || !finite(value.confidence, 0, 1) || !Array.isArray(value.words)
    || value.words.length > 500) return false;
  return value.words.every((word) => exact(word, ["text", "confidence", "bounds"])
    && typeof word.text === "string" && word.text.length >= 1 && word.text.length <= 200
    && finite(word.confidence, 0, 1) && rect(word.bounds, width, height));
}

export function parseVisualCaptureEvidence(value: unknown): VisualCaptureEvidence | null {
  if (!exact(value, [
    "mediaType", "contentBase64", "width", "height", "redactionProof", "ocrResult"
  ]) || value.mediaType !== "image/webp" || !canonicalWebpBase64(value.contentBase64)
    || !integer(value.width, 1, 8_192) || !integer(value.height, 1, 8_192)
    || (value.width as number) * (value.height as number) > 1_000_000
    || !exact(value.redactionProof, [
      "version", "maskColorRgba", "avatarBounds", "visibleRegions", "maskedRegions"
    ])) return null;
  const width = value.width as number;
  const height = value.height as number;
  const proof = value.redactionProof;
  if (proof.version !== "opaque-rect-v1" || !Array.isArray(proof.maskColorRgba)
    || proof.maskColorRgba.length !== 4
    || proof.maskColorRgba.some((channel, index) => channel !== [17, 61, 51, 255][index])
    || !(proof.avatarBounds === null || rect(proof.avatarBounds, width, height))
    || !Array.isArray(proof.visibleRegions) || proof.visibleRegions.length < 1
    || proof.visibleRegions.length > 20
    || !proof.visibleRegions.every((region) => rect(region, width, height))
    || !Array.isArray(proof.maskedRegions) || proof.maskedRegions.length < 1
    || proof.maskedRegions.length > 100
    || !proof.maskedRegions.every((region) => rect(region, width, height))
    || !ocrResult(value.ocrResult, width, height)) return null;
  let visiblePixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (proof.visibleRegions.some((region) => x >= region.x && y >= region.y
        && x < region.x + region.width && y < region.y + region.height)) visiblePixels += 1;
    }
  }
  if (visiblePixels / (width * height) > 0.8) return null;
  return value as unknown as VisualCaptureEvidence;
}

export function createVisualCaptureRuntime(dependencies: VisualCaptureRuntimeDependencies): {
  handle(request: unknown, senderTabId: number | null): Promise<
    { accepted: true; evidence: VisualCaptureEvidence } | { accepted: false }
  >;
  endSession(): Promise<boolean>;
} {
  let queue: Promise<void> = Promise.resolve();

  async function run(request: unknown, senderTabId: number | null): Promise<
    { accepted: true; evidence: VisualCaptureEvidence } | { accepted: false }
  > {
    let screenshotDataUrl: string | null = null;
    try {
      if (!await dependencies.authorize(request, senderTabId)) return { accepted: false };
      await dependencies.ensureOffscreen();
      const authorized = await dependencies.authorize(request, senderTabId);
      if (!authorized || !await dependencies.reserveOcrCall(authorized)) return { accepted: false };
      const authorizedForCapture = await dependencies.authorize(request, senderTabId);
      if (!authorizedForCapture) return { accepted: false };
      screenshotDataUrl = await dependencies.captureVisibleTab(authorizedForCapture);
      if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/u.test(screenshotDataUrl)
        || screenshotDataUrl.length > 50_000_000) return { accepted: false };
      const response = await dependencies.processOffscreen({
        ...authorized,
        kind: "visual_process_capture",
        screenshotDataUrl
      });
      if (!exact(response, ["accepted", "evidence"]) || response.accepted !== true) {
        return { accepted: false };
      }
      const evidence = parseVisualCaptureEvidence(response.evidence);
      return evidence ? { accepted: true, evidence } : { accepted: false };
    } catch {
      return { accepted: false };
    } finally {
      screenshotDataUrl = null;
    }
  }

  return {
    handle(request, senderTabId) {
      const result = queue.then(() => run(request, senderTabId));
      queue = result.then(() => undefined, () => undefined);
      return result;
    },
    async endSession() {
      const result = queue.then(() => dependencies.endOffscreenSession().catch(() => false));
      queue = result.then(() => undefined, () => undefined);
      return result;
    }
  };
}
