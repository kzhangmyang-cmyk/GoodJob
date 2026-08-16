export function createOffscreenCaptureLifecycle(): {
  begin(generation: number, releaseRaw: () => void): symbol | null;
  active(token: symbol): boolean;
  finish(token: symbol): void;
  synchronize(generation: number): void;
  end(generation: number): void;
} {
  let minimumGeneration = 0;
  const inflight = new Map<symbol, { generation: number; releaseRaw: () => void }>();
  return {
    begin(generation, releaseRaw) {
      if (!Number.isSafeInteger(generation) || generation !== minimumGeneration) return null;
      const token = Symbol("offscreen-capture");
      inflight.set(token, { generation, releaseRaw });
      return token;
    },
    active(token) {
      const entry = inflight.get(token);
      return entry !== undefined && entry.generation === minimumGeneration;
    },
    finish(token) {
      inflight.delete(token);
    },
    synchronize(generation) {
      if (!Number.isSafeInteger(generation) || generation < minimumGeneration) return;
      minimumGeneration = generation;
      for (const [token, entry] of inflight) {
        if (entry.generation >= generation) continue;
        inflight.delete(token);
        try { entry.releaseRaw(); } catch { /* fail closed; release remaining captures */ }
      }
    },
    end(generation) {
      if (!Number.isSafeInteger(generation) || generation < 0) return;
      minimumGeneration = Math.max(minimumGeneration, generation + 1);
      for (const [token, entry] of inflight) {
        if (entry.generation > generation) continue;
        inflight.delete(token);
        try { entry.releaseRaw(); } catch { /* fail closed; release remaining captures */ }
      }
    }
  };
}

export function createSensitiveResourceScope(): {
  track<T extends object>(resource: T, cleanup: (resource: T) => void): T;
  dispose(resource: object): void;
  transfer(resource: object): void;
  disposeAll(): void;
} {
  const cleanups = new Map<object, () => void>();
  return {
    track(resource, cleanup) {
      cleanups.set(resource, () => cleanup(resource));
      return resource;
    },
    dispose(resource) {
      const cleanup = cleanups.get(resource);
      cleanups.delete(resource);
      try { cleanup?.(); } catch { /* continue releasing remaining sensitive resources */ }
    },
    transfer(resource) {
      cleanups.delete(resource);
    },
    disposeAll() {
      for (const resource of [...cleanups.keys()]) this.dispose(resource);
    }
  };
}

export async function runPreparedOcr<Prepared, Result>(options: {
  prepare(): Promise<Prepared>;
  releaseRaw(): void;
  recognize(prepared: Prepared): Promise<Result>;
  releasePrepared(prepared: Prepared): void;
}): Promise<Result> {
  let prepared!: Prepared;
  try {
    prepared = await options.prepare();
  } finally {
    options.releaseRaw();
  }
  try {
    return await options.recognize(prepared);
  } finally {
    options.releasePrepared(prepared);
  }
}
