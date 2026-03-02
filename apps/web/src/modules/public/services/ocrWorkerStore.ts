type LoggerMessage = {
  status?: string;
  progress?: number;
};

type TesseractWorker = {
  setParameters: (params: Record<string, string>) => Promise<unknown>;
  terminate: () => Promise<unknown>;
  recognize: (image: HTMLCanvasElement) => Promise<{ data?: { text?: string; confidence?: number } }>;
};

type TesseractApi = {
  createWorker: (...args: unknown[]) => Promise<TesseractWorker>;
  PSM?: Record<string, string>;
  OEM?: Record<string, number>;
};

type ProgressListener = (progress: number, status: string) => void;

const listeners = new Set<ProgressListener>();
let sharedWorkerPromise: Promise<TesseractWorker> | null = null;
let sharedWorker: TesseractWorker | null = null;
let lastProgress = 0;
let lastStatus = "idle";

function notifyProgress(progress: number, status: string) {
  lastProgress = progress;
  lastStatus = status;

  for (const listener of listeners) {
    listener(progress, status);
  }
}

function getTesseractApi(moduleImport: unknown): TesseractApi {
  const moduleObject = moduleImport as Record<string, unknown>;
  if (typeof moduleObject.createWorker === "function") {
    return moduleObject as unknown as TesseractApi;
  }

  const fallback = moduleObject.default as Record<string, unknown> | undefined;
  if (fallback && typeof fallback.createWorker === "function") {
    return fallback as unknown as TesseractApi;
  }

  throw new Error("No se pudo cargar el motor OCR.");
}

function normalizeLoggerStatus(status: string) {
  if (status.includes("loading tesseract core")) {
    return "Cargando OCR core";
  }

  if (status.includes("loading language traineddata")) {
    return "Cargando modelo de lectura";
  }

  if (status.includes("initializing api")) {
    return "Inicializando OCR";
  }

  if (status.includes("recognizing text")) {
    return "Leyendo texto";
  }

  return status || "Preparando OCR";
}

export function subscribeOcrWarmup(listener: ProgressListener) {
  listeners.add(listener);
  listener(lastProgress, lastStatus);

  return () => {
    listeners.delete(listener);
  };
}

export async function getSharedOcrWorker(): Promise<TesseractWorker> {
  if (sharedWorker) {
    notifyProgress(100, "OCR listo");
    return sharedWorker;
  }

  if (sharedWorkerPromise) {
    return sharedWorkerPromise;
  }

  sharedWorkerPromise = (async () => {
    notifyProgress(1, "Preparando OCR");

    const imported = await import("tesseract.js");
    const tesseractApi = getTesseractApi(imported);

    const worker = await tesseractApi.createWorker("eng", tesseractApi.OEM?.LSTM_ONLY, {
      logger: (message: LoggerMessage) => {
        if (typeof message.progress === "number") {
          notifyProgress(Math.max(1, Math.round(message.progress * 100)), normalizeLoggerStatus(message.status ?? ""));
        }
      }
    });

    await worker.setParameters({
      tessedit_pageseg_mode: String(tesseractApi.PSM?.SINGLE_LINE ?? "7"),
      tessedit_char_whitelist: "0123456789B",
      preserve_interword_spaces: "0",
      classify_bln_numeric_mode: "1"
    });

    sharedWorker = worker;
    notifyProgress(100, "OCR listo");
    return worker;
  })();

  try {
    return await sharedWorkerPromise;
  } catch (error) {
    sharedWorkerPromise = null;
    sharedWorker = null;
    notifyProgress(0, "Error OCR");
    throw error;
  }
}

export async function warmupSharedOcrWorker() {
  try {
    await getSharedOcrWorker();
  } catch {
    // silent warmup failure, scanner panel handles explicit error
  }
}

export async function terminateSharedOcrWorker() {
  if (!sharedWorker) {
    sharedWorkerPromise = null;
    return;
  }

  const worker = sharedWorker;
  sharedWorker = null;
  sharedWorkerPromise = null;

  try {
    await worker.terminate();
  } catch {
    // ignore termination errors
  }

  notifyProgress(0, "OCR detenido");
}
