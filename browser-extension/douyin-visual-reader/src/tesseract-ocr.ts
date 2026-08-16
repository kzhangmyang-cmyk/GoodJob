import type {
  VisualOcrCrop,
  VisualOcrLanguages,
  VisualOcrPort,
  VisualOcrResult,
  VisualOcrWord
} from "./ocr-port";
import createWorker from "tesseract.js/src/createWorker.js";

interface TesseractWordLike {
  text?: unknown;
  confidence?: unknown;
  bbox?: { x0?: unknown; y0?: unknown; x1?: unknown; y1?: unknown };
}

export interface TesseractWorkerLike {
  recognize(image: Uint8Array, options: Record<string, unknown>, output: {
    text: true;
    blocks: true;
  }): Promise<{ data: {
    text?: unknown;
    confidence?: unknown;
    blocks?: unknown;
  } }>;
  terminate(): Promise<unknown>;
}

export type TesseractWorkerFactory = (
  languages: string[],
  oem: number,
  options: Record<string, unknown>
) => Promise<TesseractWorkerLike>;

async function defaultWorkerFactory(languages: string[], oem: number,
  options: Record<string, unknown>): Promise<TesseractWorkerLike> {
  return createWorker(languages, oem, options) as unknown as Promise<TesseractWorkerLike>;
}

function confidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value / 100));
}

function collectWords(value: unknown, output: VisualOcrWord[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectWords(item, output);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const candidate = record as TesseractWordLike;
  if (typeof candidate.text === "string" && candidate.text.trim()
    && candidate.bbox && typeof candidate.bbox === "object") {
    const { x0, y0, x1, y1 } = candidate.bbox;
    if ([x0, y0, x1, y1].every((coordinate) => typeof coordinate === "number"
      && Number.isFinite(coordinate))) {
      const left = Math.max(0, Math.floor(x0 as number));
      const top = Math.max(0, Math.floor(y0 as number));
      const right = Math.max(left, Math.ceil(x1 as number));
      const bottom = Math.max(top, Math.ceil(y1 as number));
      if (right > left && bottom > top) output.push({
        text: candidate.text.trim(),
        confidence: confidence(candidate.confidence),
        bounds: { x: left, y: top, width: right - left, height: bottom - top }
      });
    }
  }
  for (const [key, child] of Object.entries(record)) {
    if (!["text", "confidence", "bbox"].includes(key)) collectWords(child, output);
  }
}

export function createTesseractOcrPort(options: {
  createWorker?: TesseractWorkerFactory;
  assetBaseUrl: string;
  scheduleTimeout?: (callback: () => void, delay: number) => unknown;
  cancelTimeout?: (handle: unknown) => void;
}): VisualOcrPort & { endSession(): Promise<void> } {
  const createWorker = options.createWorker ?? defaultWorkerFactory;
  const base = options.assetBaseUrl.replace(/\/+$/u, "");
  if (!base || /^https?:/iu.test(base)) throw new Error("OCR assets must use a local extension URL");
  const scheduleTimeout = options.scheduleTimeout
    ?? ((callback: () => void, delay: number) => globalThis.setTimeout(callback, delay));
  const cancelTimeout = options.cancelTimeout
    ?? ((handle: unknown) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
  let worker: TesseractWorkerLike | null = null;
  let workerPromise: Promise<TesseractWorkerLike> | null = null;
  let idleHandle: unknown = null;

  function clearIdle(): void {
    if (idleHandle !== null) cancelTimeout(idleHandle);
    idleHandle = null;
  }

  async function terminateCurrent(): Promise<void> {
    clearIdle();
    const current = worker;
    worker = null;
    workerPromise = null;
    if (current) await current.terminate();
  }

  function scheduleIdleTermination(): void {
    clearIdle();
    idleHandle = scheduleTimeout(() => {
      idleHandle = null;
      void terminateCurrent().catch(() => undefined);
    }, 30_000);
  }

  async function currentWorker(): Promise<TesseractWorkerLike> {
    if (worker) return worker;
    if (!workerPromise) {
      workerPromise = createWorker(["chi_sim", "eng"], 1, {
        workerPath: `${base}/worker.min.js`,
        corePath: `${base}/core`,
        langPath: `${base}/lang`,
        cacheMethod: "none",
        workerBlobURL: false,
        gzip: false
      }).then((created) => {
        worker = created;
        return created;
      }, (error) => {
        workerPromise = null;
        throw error;
      });
    }
    return workerPromise;
  }

  return {
    async recognize(crop: VisualOcrCrop, languages: VisualOcrLanguages): Promise<VisualOcrResult> {
      if (languages[0] !== "chi_sim" || languages[1] !== "eng" || languages.length !== 2) {
        throw new Error("OCR languages must be chi_sim+eng");
      }
      if (crop.mediaType !== "image/webp" || !(crop.bytes instanceof Uint8Array)
        || crop.bytes.byteLength < 1 || crop.bytes.byteLength > 262_144
        || !Number.isSafeInteger(crop.width) || crop.width < 1
        || !Number.isSafeInteger(crop.height) || crop.height < 1) {
        throw new Error("invalid redacted OCR crop");
      }
      clearIdle();
      let result: Awaited<ReturnType<TesseractWorkerLike["recognize"]>>;
      try {
        result = await (await currentWorker()).recognize(crop.bytes, {}, { text: true, blocks: true });
      } finally {
        scheduleIdleTermination();
      }
      const words: VisualOcrWord[] = [];
      collectWords(result.data.blocks, words);
      return {
        text: typeof result.data.text === "string" ? result.data.text.normalize("NFC").trim() : "",
        confidence: confidence(result.data.confidence),
        words
      };
    },
    endSession: terminateCurrent
  };
}
