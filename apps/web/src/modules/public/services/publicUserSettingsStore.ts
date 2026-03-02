import type { DeviceProfile } from "../utils/deviceProfile";

export type UserScanPatch = Partial<
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

export type PublicUserSettings = {
  darkMode: boolean;
  scanPatch: UserScanPatch;
  updatedAt: string;
};

const STORAGE_PREFIX = "numicheck_public_settings_v1";
const SETTINGS_EVENT = "numicheck:user-settings-updated";

function getStorageKey(uid: string | null | undefined) {
  return `${STORAGE_PREFIX}:${uid?.trim() || "guest"}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeScanPatch(raw: unknown): UserScanPatch {
  if (!raw || typeof raw !== "object") {
    return {};
  }

  const source = raw as Record<string, unknown>;
  const patch: UserScanPatch = {};
  const normalize = (key: keyof UserScanPatch, min: number, max: number) => {
    const value = source[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return;
    }

    patch[key] = clamp(Math.round(value), min, max);
  };

  normalize("baseDelayMs", 80, 600);
  normalize("badFrameDelayMs", 60, 500);
  normalize("ocrMissDelayMs", 80, 600);
  normalize("readHitDelayMs", 40, 320);
  normalize("requiredHits", 1, 3);
  normalize("fastAcceptConfidence", 58, 95);
  normalize("immediateAcceptConfidence", 62, 98);
  normalize("qualityAcceptFloor", 44, 90);
  normalize("maxOcrMs", 320, 1600);

  return patch;
}

function normalizeSettings(raw: Partial<PublicUserSettings> | null | undefined): PublicUserSettings {
  return {
    darkMode: raw?.darkMode === true,
    scanPatch: normalizeScanPatch(raw?.scanPatch),
    updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : new Date().toISOString()
  };
}

export function getPublicUserSettings(uid: string | null | undefined) {
  const key = getStorageKey(uid);
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return normalizeSettings(null);
    }

    return normalizeSettings(JSON.parse(raw) as Partial<PublicUserSettings>);
  } catch {
    return normalizeSettings(null);
  }
}

export function savePublicUserSettings(uid: string | null | undefined, next: Partial<PublicUserSettings>) {
  const current = getPublicUserSettings(uid);
  const merged = normalizeSettings({
    ...current,
    ...next,
    scanPatch: {
      ...current.scanPatch,
      ...(next.scanPatch ?? {})
    },
    updatedAt: new Date().toISOString()
  });

  const key = getStorageKey(uid);
  window.localStorage.setItem(key, JSON.stringify(merged));
  window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: { uid: uid ?? "guest" } }));
  return merged;
}

export function resetPublicUserScanPatch(uid: string | null | undefined) {
  const current = getPublicUserSettings(uid);
  const next = normalizeSettings({
    ...current,
    scanPatch: {},
    updatedAt: new Date().toISOString()
  });

  const key = getStorageKey(uid);
  window.localStorage.setItem(key, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: { uid: uid ?? "guest" } }));
  return next;
}

export function subscribePublicUserSettings(onUpdate: () => void) {
  const handler = () => onUpdate();
  window.addEventListener(SETTINGS_EVENT, handler);
  return () => window.removeEventListener(SETTINGS_EVENT, handler);
}
