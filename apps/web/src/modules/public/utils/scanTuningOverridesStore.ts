import type { DeviceProfile, DeviceTier } from "./deviceProfile";
import type { ScannerDenomination } from "./scanRegionProfiles";

export type ScanTuningPatch = Partial<
  Pick<
    DeviceProfile,
    | "baseDelayMs"
    | "badFrameDelayMs"
    | "ocrMissDelayMs"
    | "readHitDelayMs"
    | "requiredHits"
    | "fastAcceptConfidence"
    | "immediateAcceptConfidence"
    | "qualityAcceptFloor"
    | "maxOcrMs"
  >
>;

export type ScanTuningOverride = {
  id: string;
  label: string;
  userAgentPattern: string;
  denomination: "all" | ScannerDenomination;
  enabled: boolean;
  tierOverride: DeviceTier | "auto";
  patch: ScanTuningPatch;
  createdAt: string;
  updatedAt: string;
};

const STORAGE_KEY = "numicheck_scan_tuning_overrides_v1";

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePatch(patch: ScanTuningPatch): ScanTuningPatch {
  const result: ScanTuningPatch = {};
  const numericKeys = [
    "baseDelayMs",
    "badFrameDelayMs",
    "ocrMissDelayMs",
    "readHitDelayMs",
    "requiredHits",
    "fastAcceptConfidence",
    "immediateAcceptConfidence",
    "qualityAcceptFloor",
    "maxOcrMs"
  ] as const;

  for (const key of numericKeys) {
    const raw = patch[key];
    if (typeof raw !== "number" || Number.isNaN(raw) || !Number.isFinite(raw)) {
      continue;
    }

    result[key] = Math.round(raw);
  }

  return result;
}

function normalizeRow(row: Partial<ScanTuningOverride>, index: number): ScanTuningOverride {
  const now = new Date().toISOString();

  return {
    id: row.id?.trim() || `row-${index + 1}`,
    label: row.label?.trim() || `Perfil ${index + 1}`,
    userAgentPattern: row.userAgentPattern?.trim() || "",
    denomination: row.denomination === "10" || row.denomination === "20" || row.denomination === "50" ? row.denomination : "all",
    enabled: row.enabled !== false,
    tierOverride:
      row.tierOverride === "low" || row.tierOverride === "mid" || row.tierOverride === "high"
        ? row.tierOverride
        : "auto",
    patch: normalizePatch(row.patch ?? {}),
    createdAt: row.createdAt || now,
    updatedAt: row.updatedAt || now
  };
}

function readStore(): ScanTuningOverride[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as Partial<ScanTuningOverride>[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map((row, index) => normalizeRow(row, index));
  } catch {
    return [];
  }
}

function writeStore(rows: ScanTuningOverride[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
}

export function getScanTuningOverrides() {
  return readStore().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveScanTuningOverrides(rows: ScanTuningOverride[]) {
  writeStore(rows.map((row, index) => normalizeRow(row, index)));
}

export function createScanTuningOverride(partial?: Partial<ScanTuningOverride>): ScanTuningOverride {
  const now = new Date().toISOString();

  return normalizeRow(
    {
      id: makeId(),
      label: partial?.label ?? "Nuevo perfil",
      userAgentPattern: partial?.userAgentPattern ?? "",
      denomination: partial?.denomination ?? "all",
      enabled: partial?.enabled ?? true,
      tierOverride: partial?.tierOverride ?? "auto",
      patch: partial?.patch ?? {},
      createdAt: now,
      updatedAt: now
    },
    0
  );
}

export function upsertScanTuningOverride(row: ScanTuningOverride) {
  const current = readStore();
  const index = current.findIndex((entry) => entry.id === row.id);
  const next = normalizeRow({ ...row, updatedAt: new Date().toISOString() }, 0);

  if (index === -1) {
    current.push(next);
  } else {
    current[index] = {
      ...current[index],
      ...next,
      createdAt: current[index].createdAt
    };
  }

  writeStore(current);
}

export function deleteScanTuningOverride(id: string) {
  const next = readStore().filter((row) => row.id !== id);
  writeStore(next);
}

function matchesUserAgent(userAgent: string, pattern: string) {
  const normalizedPattern = pattern.trim().toLowerCase();
  if (!normalizedPattern) {
    return false;
  }

  return userAgent.toLowerCase().includes(normalizedPattern);
}

export function findMatchingScanTuningOverride(userAgent: string, denomination: ScannerDenomination) {
  const candidates = readStore()
    .filter((row) => row.enabled)
    .filter((row) => row.denomination === "all" || row.denomination === denomination)
    .filter((row) => matchesUserAgent(userAgent, row.userAgentPattern));

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => {
    if (b.userAgentPattern.length !== a.userAgentPattern.length) {
      return b.userAgentPattern.length - a.userAgentPattern.length;
    }

    return b.updatedAt.localeCompare(a.updatedAt);
  });

  return candidates[0] ?? null;
}
