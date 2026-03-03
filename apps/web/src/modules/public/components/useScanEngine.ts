import type { DeviceTier } from "../utils/deviceProfile";

export type Candidate = {
  serial: string;
  confidence: number;
  quality: number;
  score: number;
  zoneLabel: string;
  regionIndex: number;
};

export type CandidateVote = Candidate & {
  votes: number;
  firstSeenAt: number;
};

export type OcrSizeProfile = {
  tier: DeviceTier;
  maxDigits: number;
};

const MIN_CONFIDENCE = 12;
const OCR_QUALITY_CONFIDENCE_BOOST_FACTOR = 0.12;
const OCR_FULL_LENGTH_BONUS = 10;
const OCR_ALMOST_FULL_LENGTH_BONUS = 6;
const ADAPTIVE_DELAY_MIN_MS = 16;
const ADAPTIVE_DELAY_MAX_MS = 54;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function hammingDistance(left: string, right: string) {
  if (left.length !== right.length) {
    return Number.POSITIVE_INFINITY;
  }

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      diff += 1;
    }
  }

  return diff;
}

function getTierScale(tier: DeviceTier, mode: "quick" | "deep") {
  if (mode === "quick") {
    if (tier === "high") {
      return 0.5;
    }

    if (tier === "low") {
      return 0.58;
    }

    return 0.54;
  }

  if (tier === "high") {
    return 0.68;
  }

  if (tier === "low") {
    return 0.8;
  }

  return 0.74;
}

export function getOcrTargetSize(
  regionWidth: number,
  regionHeight: number,
  mode: "quick" | "deep",
  profile: OcrSizeProfile
) {
  const lengthAdjust = profile.maxDigits >= 9 ? 1 : 0.92;
  const scale = getTierScale(profile.tier, mode) * lengthAdjust;

  if (mode === "quick") {
    const width = Math.max(210, Math.min(300, Math.round(regionWidth * scale)));
    const ratio = width / Math.max(1, regionWidth);
    const height = Math.max(56, Math.min(80, Math.round(regionHeight * ratio)));
    return { width, height };
  }

  const width = Math.max(280, Math.min(380, Math.round(regionWidth * scale)));
  const ratio = width / Math.max(1, regionWidth);
  const height = Math.max(78, Math.min(90, Math.round(regionHeight * ratio)));
  return { width, height };
}

export function fixAmbiguousDigits(raw: string): string {
  const replacements: Record<string, string> = {
    O: "0",
    o: "0",
    I: "1",
    l: "1",
    B: "8",
    S: "5",
    s: "5",
    Z: "2",
    G: "6",
    g: "9",
    q: "9"
  };

  return raw.replace(/[OoIlBSsZGgq]/g, (character) => replacements[character] ?? character);
}

export function buildConsensusSerial(candidates: CandidateVote[]) {
  const first = candidates[0];
  if (!first) {
    return "";
  }

  const length = first.serial.length;
  let serial = "";

  for (let digitIndex = 0; digitIndex < length; digitIndex += 1) {
    const counts = new Map<string, number>();

    candidates.forEach((candidate) => {
      const digit = candidate.serial[digitIndex] ?? "";
      if (!digit) {
        return;
      }

      counts.set(digit, (counts.get(digit) ?? 0) + Math.max(1, candidate.votes));
    });

    let bestDigit = first.serial[digitIndex] ?? "";
    let bestCount = -1;
    counts.forEach((count, digit) => {
      if (count > bestCount) {
        bestCount = count;
        bestDigit = digit;
      }
    });

    serial += bestDigit;
  }

  return serial;
}

export function chooseBestCandidateFromVotes(voteMap: Map<string, CandidateVote>) {
  if (voteMap.size === 0) {
    return null;
  }

  const raw = Array.from(voteMap.values());
  if (raw.length === 1) {
    return raw[0] ?? null;
  }

  const fuzzyMerged: CandidateVote[] = [];

  raw.forEach((anchor) => {
    const cluster = raw.filter((candidate) => hammingDistance(anchor.serial, candidate.serial) <= 1);

    if (cluster.length <= 1) {
      fuzzyMerged.push(anchor);
      return;
    }

    const totalVotes = cluster.reduce((sum, item) => sum + item.votes, 0);
    const weightedConfidence = Math.round(
      cluster.reduce((sum, item) => sum + item.confidence * item.votes, 0) / Math.max(1, totalVotes)
    );
    const weightedQuality = Math.round(
      cluster.reduce((sum, item) => sum + item.quality * item.votes, 0) / Math.max(1, totalVotes)
    );
    const weightedScore =
      cluster.reduce((sum, item) => sum + item.score * item.votes, 0) / Math.max(1, totalVotes) + totalVotes * 2.5;
    const consensusSerial = buildConsensusSerial(cluster);
    const representative = [...cluster].sort((a, b) => b.votes - a.votes || b.score - a.score)[0] ?? anchor;
    const firstSeenAt = Math.min(...cluster.map((item) => item.firstSeenAt));

    fuzzyMerged.push({
      serial: consensusSerial || anchor.serial,
      confidence: clamp(weightedConfidence + Math.min(8, totalVotes), MIN_CONFIDENCE, 99),
      quality: clamp(weightedQuality, 0, 100),
      score: weightedScore,
      zoneLabel: representative.zoneLabel,
      regionIndex: representative.regionIndex,
      votes: totalVotes,
      firstSeenAt
    });
  });

  const deduped = new Map<string, CandidateVote>();
  fuzzyMerged.forEach((candidate) => {
    const existing = deduped.get(candidate.serial);
    if (!existing || candidate.votes > existing.votes || candidate.score > existing.score) {
      deduped.set(candidate.serial, candidate);
    }
  });

  const ordered = Array.from(deduped.values()).sort((a, b) => {
    if (b.votes !== a.votes) {
      return b.votes - a.votes;
    }

    if (b.score !== a.score) {
      return b.score - a.score;
    }

    if (b.confidence !== a.confidence) {
      return b.confidence - a.confidence;
    }

    return a.firstSeenAt - b.firstSeenAt;
  });

  return ordered[0] ?? null;
}

export function computeOtsuThresholdFromRgba(data: Uint8ClampedArray, sampleStride = 2) {
  const histogram = new Uint32Array(256);
  const stride = Math.max(1, Math.trunc(sampleStride));
  const step = stride * 4;
  let totalPixels = 0;

  let total = 0;
  for (let index = 0; index < data.length; index += step) {
    const luma = ((data[index] * 77 + data[index + 1] * 150 + data[index + 2] * 29) >> 8) & 0xff;
    histogram[luma] += 1;
    total += luma;
    totalPixels += 1;
  }

  if (totalPixels <= 0) {
    return 128;
  }

  let sumBackground = 0;
  let weightBackground = 0;
  let bestBetweenVariance = 0;
  let threshold = 128;

  for (let tone = 0; tone < 256; tone += 1) {
    weightBackground += histogram[tone];
    if (weightBackground === 0) {
      continue;
    }

    const weightForeground = totalPixels - weightBackground;
    if (weightForeground <= 0) {
      break;
    }

    sumBackground += tone * histogram[tone];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (total - sumBackground) / weightForeground;
    const betweenVariance = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;

    if (betweenVariance > bestBetweenVariance) {
      bestBetweenVariance = betweenVariance;
      threshold = tone;
    }
  }

  return threshold;
}

export function drawRegionForOcr(
  frameCanvas: HTMLCanvasElement,
  targetCanvas: HTMLCanvasElement,
  region: { left: number; top: number; width: number; height: number },
  mode: "quick" | "deep",
  sizeProfile: OcrSizeProfile,
  applyAdaptiveThreshold: boolean
) {
  const context = targetCanvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("No se pudo preparar el contexto OCR.");
  }

  const size = getOcrTargetSize(region.width, region.height, mode, sizeProfile);
  targetCanvas.width = size.width;
  targetCanvas.height = size.height;

  context.imageSmoothingEnabled = mode === "deep";
  context.filter = mode === "quick" ? "grayscale(1) contrast(1.6) brightness(1.05)" : "grayscale(1) contrast(2.05) brightness(1.08)";
  context.drawImage(
    frameCanvas,
    region.left,
    region.top,
    region.width,
    region.height,
    0,
    0,
    size.width,
    size.height
  );
  context.filter = "none";

  if ((mode === "deep" || mode === "quick") && applyAdaptiveThreshold) {
    const image = context.getImageData(0, 0, size.width, size.height);
    const data = image.data;
    const sampleStride = mode === "quick" ? 3 : sizeProfile.tier === "high" ? 3 : 2;
    const threshold = computeOtsuThresholdFromRgba(data, sampleStride);
    const high = Math.min(255, threshold + 18);
    const low = Math.max(0, threshold - 18);
    const span = Math.max(1, high - low);

    for (let i = 0; i < data.length; i += 4) {
      const gray = data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
      let boosted = 0;
      if (gray >= high) {
        boosted = 255;
      } else if (gray <= low) {
        boosted = 0;
      } else {
        boosted = Math.round(((gray - low) / span) * 255);
      }
      data[i] = boosted;
      data[i + 1] = boosted;
      data[i + 2] = boosted;
    }

    context.putImageData(image, 0, 0);
  }
}

export function getAdaptiveBurstDelay(avgOcrMs: number, readHitDelayMs: number) {
  const raw = Math.round(avgOcrMs * 0.22 + readHitDelayMs * 0.28);
  return clamp(raw, ADAPTIVE_DELAY_MIN_MS, ADAPTIVE_DELAY_MAX_MS);
}

export function shiftRegion(
  region: { left: number; top: number; width: number; height: number },
  frameWidth: number,
  frameHeight: number,
  horizontalOffsetPercent: number
) {
  const shift = Math.round(region.width * horizontalOffsetPercent);
  const left = clamp(region.left + shift, 0, Math.max(0, frameWidth - region.width));
  const top = clamp(region.top, 0, Math.max(0, frameHeight - region.height));

  return {
    left,
    top,
    width: region.width,
    height: region.height
  };
}

export function boostConfidenceFromQuality(
  confidence: number,
  quality: number,
  candidateLength: number,
  targetMaxDigits: number
) {
  let boosted = confidence + Math.round(quality * OCR_QUALITY_CONFIDENCE_BOOST_FACTOR);

  if (candidateLength >= targetMaxDigits) {
    boosted += OCR_FULL_LENGTH_BONUS;
  } else if (candidateLength >= targetMaxDigits - 1) {
    boosted += OCR_ALMOST_FULL_LENGTH_BONUS;
  }

  return clamp(boosted, confidence, 99);
}
