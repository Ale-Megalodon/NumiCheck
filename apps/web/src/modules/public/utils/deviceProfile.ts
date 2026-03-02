import { findMatchingScanTuningOverride, type ScanTuningOverride } from "./scanTuningOverridesStore";
import type { ScannerDenomination } from "./scanRegionProfiles";

export type DeviceTier = "low" | "mid" | "high";

export type DeviceProfile = {
  tier: DeviceTier;
  baseDelayMs: number;
  badFrameDelayMs: number;
  ocrMissDelayMs: number;
  readHitDelayMs: number;
  requiredHits: number;
  fastAcceptConfidence: number;
  immediateAcceptConfidence: number;
  qualityAcceptFloor: number;
  maxOcrMs: number;
};

export type DeviceProfileResolution = {
  profile: DeviceProfile;
  source: "auto" | "override";
  matchedOverride: ScanTuningOverride | null;
  userAgent: string;
  modelHint: string;
  cores: number;
  memory: number;
};

const PROFILES: Record<DeviceTier, DeviceProfile> = {
  low: {
    tier: "low",
    baseDelayMs: 170,
    badFrameDelayMs: 120,
    ocrMissDelayMs: 140,
    readHitDelayMs: 70,
    requiredHits: 1,
    fastAcceptConfidence: 76,
    immediateAcceptConfidence: 82,
    qualityAcceptFloor: 60,
    maxOcrMs: 760
  },
  mid: {
    tier: "mid",
    baseDelayMs: 150,
    badFrameDelayMs: 110,
    ocrMissDelayMs: 125,
    readHitDelayMs: 62,
    requiredHits: 1,
    fastAcceptConfidence: 74,
    immediateAcceptConfidence: 80,
    qualityAcceptFloor: 58,
    maxOcrMs: 700
  },
  high: {
    tier: "high",
    baseDelayMs: 130,
    badFrameDelayMs: 95,
    ocrMissDelayMs: 105,
    readHitDelayMs: 50,
    requiredHits: 1,
    fastAcceptConfidence: 72,
    immediateAcceptConfidence: 78,
    qualityAcceptFloor: 56,
    maxOcrMs: 620
  }
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function getHardwareHints() {
  const cores = navigator.hardwareConcurrency || 4;
  const memory = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4);
  const userAgent = navigator.userAgent || "unknown";

  let modelHint = "unknown";
  const androidMatch = userAgent.match(/;\s*([^;]+?)\s+Build\//i);
  const iphoneMatch = userAgent.match(/\((iPhone[^;)]*)/i);
  const ipadMatch = userAgent.match(/\((iPad[^;)]*)/i);

  if (androidMatch?.[1]) {
    modelHint = androidMatch[1].trim();
  } else if (iphoneMatch?.[1]) {
    modelHint = iphoneMatch[1].trim();
  } else if (ipadMatch?.[1]) {
    modelHint = ipadMatch[1].trim();
  }

  return { cores, memory, userAgent, modelHint };
}

export function detectDeviceTier(): DeviceTier {
  const { cores, memory } = getHardwareHints();

  if (cores <= 4 || memory <= 4) {
    return "low";
  }

  if (cores >= 8 && memory >= 8) {
    return "high";
  }

  return "mid";
}

function sanitizeProfile(profile: DeviceProfile): DeviceProfile {
  return {
    tier: profile.tier,
    baseDelayMs: clamp(Math.round(profile.baseDelayMs), 80, 600),
    badFrameDelayMs: clamp(Math.round(profile.badFrameDelayMs), 60, 500),
    ocrMissDelayMs: clamp(Math.round(profile.ocrMissDelayMs), 80, 600),
    readHitDelayMs: clamp(Math.round(profile.readHitDelayMs), 40, 320),
    requiredHits: clamp(Math.round(profile.requiredHits), 1, 3),
    fastAcceptConfidence: clamp(Math.round(profile.fastAcceptConfidence), 64, 95),
    immediateAcceptConfidence: clamp(Math.round(profile.immediateAcceptConfidence), 68, 98),
    qualityAcceptFloor: clamp(Math.round(profile.qualityAcceptFloor), 48, 90),
    maxOcrMs: clamp(Math.round(profile.maxOcrMs), 320, 1600)
  };
}

export function resolveDeviceProfileForDenomination(denomination: ScannerDenomination): DeviceProfileResolution {
  const identity = getHardwareHints();
  const autoTier = detectDeviceTier();
  const baseProfile = PROFILES[autoTier];
  const matchedOverride = findMatchingScanTuningOverride(identity.userAgent, denomination);

  if (!matchedOverride) {
    return {
      profile: sanitizeProfile(baseProfile),
      source: "auto",
      matchedOverride: null,
      userAgent: identity.userAgent,
      modelHint: identity.modelHint,
      cores: identity.cores,
      memory: identity.memory
    };
  }

  const tier =
    matchedOverride.tierOverride === "low" ||
    matchedOverride.tierOverride === "mid" ||
    matchedOverride.tierOverride === "high"
      ? matchedOverride.tierOverride
      : autoTier;

  const overrideBase = PROFILES[tier];
  const merged: DeviceProfile = {
    ...overrideBase,
    ...matchedOverride.patch,
    tier
  };

  return {
    profile: sanitizeProfile(merged),
    source: "override",
    matchedOverride,
    userAgent: identity.userAgent,
    modelHint: identity.modelHint,
    cores: identity.cores,
    memory: identity.memory
  };
}

export function getDeviceProfile(): DeviceProfile {
  return resolveDeviceProfileForDenomination("10").profile;
}

export function getDeviceProfileForDenomination(denomination: ScannerDenomination): DeviceProfile {
  return resolveDeviceProfileForDenomination(denomination).profile;
}
