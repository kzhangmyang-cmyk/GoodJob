import { createTesseractOcrPort } from "./tesseract-ocr";
import { redactCommentCard, type RasterImage } from "./visual-pipeline";
import type { VisualCaptureRequest } from "./visual-capture-guard";
import { assertLosslessRedactedWebp } from "./webp-redaction-policy";

declare const chrome: any;

const ocr = createTesseractOcrPort({ assetBaseUrl: chrome.runtime.getURL("ocr") });

function canvas(width: number, height: number): HTMLCanvasElement {
  const value = document.createElement("canvas");
  value.width = width;
  value.height = height;
  return value;
}

function imageFromDataUrl(value: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("screenshot decode failed"));
    image.src = value;
  });
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function toWebp(target: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => target.toBlob((blob) => {
    if (!blob || blob.type !== "image/webp") reject(new Error("WebP encode failed"));
    else resolve(blob);
  }, "image/webp", quality));
}

async function encodeWithinLimit(image: RasterImage): Promise<Uint8Array> {
  const target = canvas(image.width, image.height);
  const context = target.getContext("2d", { alpha: true });
  if (!context) throw new Error("canvas unavailable");
  const canvasPixels = new Uint8ClampedArray(image.pixels.length);
  canvasPixels.set(image.pixels);
  context.putImageData(new ImageData(canvasPixels, image.width, image.height), 0, 0);
  let decodedCanvas: HTMLCanvasElement | null = null;
  let decodedPixels: Uint8ClampedArray | null = null;
  let bitmap: ImageBitmap | null = null;
  try {
    const blob = await toWebp(target, 1);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    bitmap = await createImageBitmap(blob);
    if (bitmap.width !== image.width || bitmap.height !== image.height) {
      throw new Error("redacted WebP dimensions changed");
    }
    decodedCanvas = canvas(image.width, image.height);
    const decodedContext = decodedCanvas.getContext("2d", { alpha: true, willReadFrequently: true });
    if (!decodedContext) throw new Error("canvas unavailable");
    decodedContext.drawImage(bitmap, 0, 0);
    decodedPixels = decodedContext.getImageData(0, 0, image.width, image.height).data;
    assertLosslessRedactedWebp({
      encodedByteLength: bytes.byteLength,
      original: image.pixels,
      decoded: decodedPixels
    });
    return bytes;
  } finally {
    decodedPixels?.fill(0);
    decodedPixels = null;
    bitmap?.close();
    bitmap = null;
    if (decodedCanvas) {
      decodedCanvas.width = 1;
      decodedCanvas.height = 1;
    }
    decodedCanvas = null;
    canvasPixels.fill(0);
    target.width = 1;
    target.height = 1;
  }
}

async function processCapture(message: VisualCaptureRequest & { screenshotDataUrl: string }) {
  let screenshotDataUrl: string | null = message.screenshotDataUrl;
  let sourceImage: HTMLImageElement | null = null;
  let sourceCanvas: HTMLCanvasElement | null = null;
  let screenshot: RasterImage | null = null;
  let redactedPixels: Uint8ClampedArray | null = null;
  let redactedBytes: Uint8Array | null = null;
  try {
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/u.test(screenshotDataUrl)
      || screenshotDataUrl.length > 50_000_000) throw new Error("invalid screenshot transport");
    sourceImage = await imageFromDataUrl(screenshotDataUrl);
    sourceCanvas = canvas(sourceImage.naturalWidth, sourceImage.naturalHeight);
    const context = sourceCanvas.getContext("2d", { alpha: true, willReadFrequently: true });
    if (!context) throw new Error("canvas unavailable");
    context.drawImage(sourceImage, 0, 0);
    const decoded = context.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    screenshot = { width: decoded.width, height: decoded.height, pixels: decoded.data };
    const redacted = redactCommentCard({
      screenshot,
      viewport: message.viewport,
      cardBounds: message.cardBounds,
      avatarBounds: message.avatarBounds,
      visibleRegions: message.visibleRegions
    });
    redactedPixels = redacted.image.pixels;
    const bytes = await encodeWithinLimit(redacted.image);
    redactedBytes = bytes;
    const result = await ocr.recognize({
      mediaType: "image/webp",
      bytes,
      width: redacted.image.width,
      height: redacted.image.height
    }, ["chi_sim", "eng"]);
    return {
      mediaType: "image/webp" as const,
      contentBase64: base64(bytes),
      width: redacted.image.width,
      height: redacted.image.height,
      redactionProof: redacted.redactionProof,
      ocrResult: result
    };
  } finally {
    screenshot?.pixels.fill(0);
    screenshot = null;
    redactedPixels?.fill(0);
    redactedPixels = null;
    redactedBytes?.fill(0);
    redactedBytes = null;
    screenshotDataUrl = null;
    if (sourceImage) sourceImage.src = "";
    sourceImage = null;
    if (sourceCanvas) {
      sourceCanvas.width = 1;
      sourceCanvas.height = 1;
    }
    sourceCanvas = null;
    message.screenshotDataUrl = "";
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender: any,
  sendResponse: (value: unknown) => void) => {
  if (sender?.id !== chrome.runtime.id || !message || typeof message !== "object") return;
  const value = message as Record<string, unknown>;
  if (value.kind === "visual_ocr_end_session" && Object.keys(value).length === 1) {
    void ocr.endSession().then(() => sendResponse({ accepted: true }),
      () => sendResponse({ accepted: false }));
    return true;
  }
  if (value.kind !== "visual_process_capture" || Object.keys(value).length !== 8) return;
  void processCapture({ ...value, kind: "visual_capture_request" } as unknown as VisualCaptureRequest & {
    screenshotDataUrl: string;
  }).then((evidence) => sendResponse({ accepted: true, evidence }),
    () => sendResponse({ accepted: false }));
  return true;
});
