import type { DeviceProfile } from "./deviceProfile";
import type { ScannerDenomination } from "./scanRegionProfiles";

type ScanSample = {
  ocrMs: number;
  quality: number;
  confidence: number;
  success: boolean;
  zoneLabel: string;
};

type DenominationTelemetry = {
  attempts: number;
  successes: number;
  avgOcrMs: number;
  avgQuality: number;
  avgConfidence: number;
  zoneWins: Record<string, number>;
};

export type TelemetryStore = Record<ScannerDenomination, DenominationTelemetry>;

type AdaptiveThresholds = {
  requiredHits: number;
  fastAcceptConfidence: number;
  immediateAcceptConfidence: number;
  qualityAcceptFloor: number;
};

const STORAGE_KEY = "numicheck_scan_telemetry_v1";
let lastWriteAt = 0;

function createDefaultTelemetry(): DenominationTelemetry {
  return {
    attempts: 0,
    successes: 0,
    avgOcrMs: 0,
    avgQuality: 0,
    avgConfidence: 0,
    zoneWins: {}
  };
}

function createDefaultStore(): TelemetryStore {
  return {
    "10": createDefaultTelemetry(),
    "20": createDefaultTelemetry(),
    "50": createDefaultTelemetry()
  };
}

function readStore(): TelemetryStore {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return createDefaultStore();
    }

    const parsed = JSON.parse(raw) as Partial<TelemetryStore>;
    const defaults = createDefaultStore();

    return {
      "10": { ...defaults["10"], ...(parsed["10"] ?? {}) },
      "20": { ...defaults["20"], ...(parsed["20"] ?? {}) },
      "50": { ...defaults["50"], ...(parsed["50"] ?? {}) }
    };
  } catch {
    return createDefaultStore();
  }
}

function writeStore(store: TelemetryStore) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function mixAverage(currentAverage: number, currentCount: number, value: number) {
  if (currentCount <= 0) {
    return value;
  }

  return (currentAverage * currentCount + value) / (currentCount + 1);
}

export function getDenominationTelemetry(denomination: ScannerDenomination): DenominationTelemetry {
  return readStore()[denomination];
}

export function getScanTelemetryStore(): TelemetryStore {
  return readStore();
}

export function recordScanSample(denomination: ScannerDenomination, sample: ScanSample) {
  const now = Date.now();

  if (!sample.success && now - lastWriteAt < 230) {
    return;
  }

  const store = readStore();
  const current = store[denomination] ?? createDefaultTelemetry();
  const nextAttempts = current.attempts + 1;
  const nextSuccesses = current.successes + (sample.success ? 1 : 0);

  const updated: DenominationTelemetry = {
    attempts: nextAttempts,
    successes: nextSuccesses,
    avgOcrMs: mixAverage(current.avgOcrMs, current.attempts, sample.ocrMs),
    avgQuality: mixAverage(current.avgQuality, current.attempts, sample.quality),
    avgConfidence: mixAverage(current.avgConfidence, current.attempts, sample.confidence),
    zoneWins: { ...current.zoneWins }
  };

  if (sample.success) {
    updated.zoneWins[sample.zoneLabel] = (updated.zoneWins[sample.zoneLabel] ?? 0) + 1;
  }

  store[denomination] = updated;
  writeStore(store);
  lastWriteAt = now;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function getAdaptiveThresholds(
  denomination: ScannerDenomination,
  profile: DeviceProfile
): AdaptiveThresholds {
  const telemetry = getDenominationTelemetry(denomination);

  let requiredHits = profile.requiredHits;
  let fastAcceptConfidence = profile.fastAcceptConfidence;
  let immediateAcceptConfidence = profile.immediateAcceptConfidence;
  let qualityAcceptFloor = profile.qualityAcceptFloor;

  if (telemetry.successes >= 14) {
    if (telemetry.avgConfidence >= 73 && telemetry.avgOcrMs <= 520) {
      requiredHits = Math.max(1, requiredHits - 1);
      fastAcceptConfidence -= 3;
      immediateAcceptConfidence -= 2;
      qualityAcceptFloor -= 2;
    }

    if (telemetry.avgConfidence <= 57 || telemetry.avgQuality <= 52) {
      requiredHits = Math.min(3, requiredHits + 1);
      fastAcceptConfidence += 3;
      immediateAcceptConfidence += 3;
      qualityAcceptFloor += 2;
    }
  }

  return {
    requiredHits: clamp(requiredHits, 1, 3),
    fastAcceptConfidence: clamp(fastAcceptConfidence, 68, 95),
    immediateAcceptConfidence: clamp(immediateAcceptConfidence, 72, 98),
    qualityAcceptFloor: clamp(qualityAcceptFloor, 54, 85)
  };
}

export function sortZoneLabelsByTelemetry(
  denomination: ScannerDenomination,
  labels: string[]
): string[] {
  const telemetry = getDenominationTelemetry(denomination);

  return [...labels].sort((a, b) => {
    const winsA = telemetry.zoneWins[a] ?? 0;
    const winsB = telemetry.zoneWins[b] ?? 0;
    return winsB - winsA;
  });
}

export function resetScanTelemetryStore() {
  writeStore(createDefaultStore());
}
