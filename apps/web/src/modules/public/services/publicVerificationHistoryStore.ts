import type { Denomination } from "../../admin/services/illegalRangesStore";

export type VerificationSource = "manual" | "scan_camera" | "scan_upload";

export type VerificationHistoryEntry = {
  id: string;
  denomination: Denomination;
  serial: string;
  status: "legal" | "illegal";
  source: VerificationSource;
  confidence: number | null;
  quality: number | null;
  createdAt: string;
};

const STORAGE_PREFIX = "numicheck_verification_history_v1";
const MAX_HISTORY_ITEMS = 320;

function getStorageKey(uid: string | null | undefined) {
  return `${STORAGE_PREFIX}:${uid?.trim() || "guest"}`;
}

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeEntry(raw: Partial<VerificationHistoryEntry>): VerificationHistoryEntry | null {
  const denomination = raw.denomination;
  const status = raw.status;
  const source = raw.source;
  const serial = String(raw.serial ?? "").replace(/\D/g, "");

  if (
    (denomination !== "10" && denomination !== "20" && denomination !== "50") ||
    (status !== "legal" && status !== "illegal") ||
    (source !== "manual" && source !== "scan_camera" && source !== "scan_upload") ||
    serial.length < 6
  ) {
    return null;
  }

  const confidence =
    typeof raw.confidence === "number" && Number.isFinite(raw.confidence) ? Math.max(0, Math.min(100, Math.round(raw.confidence))) : null;
  const quality =
    typeof raw.quality === "number" && Number.isFinite(raw.quality) ? Math.max(0, Math.min(100, Math.round(raw.quality))) : null;

  return {
    id: raw.id?.trim() || makeId(),
    denomination,
    serial,
    status,
    source,
    confidence,
    quality,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString()
  };
}

function readStore(uid: string | null | undefined) {
  const key = getStorageKey(uid);
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as Partial<VerificationHistoryEntry>[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => sanitizeEntry(item))
      .filter((item): item is VerificationHistoryEntry => Boolean(item))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

function writeStore(uid: string | null | undefined, rows: VerificationHistoryEntry[]) {
  const key = getStorageKey(uid);
  window.localStorage.setItem(key, JSON.stringify(rows.slice(0, MAX_HISTORY_ITEMS)));
}

export function getVerificationHistory(uid: string | null | undefined) {
  return readStore(uid);
}

export function appendVerificationHistory(uid: string | null | undefined, entry: Omit<VerificationHistoryEntry, "id" | "createdAt">) {
  const current = readStore(uid);
  const next: VerificationHistoryEntry = {
    ...entry,
    id: makeId(),
    createdAt: new Date().toISOString()
  };

  writeStore(uid, [next, ...current]);
}

export function clearVerificationHistory(uid: string | null | undefined) {
  writeStore(uid, []);
}
