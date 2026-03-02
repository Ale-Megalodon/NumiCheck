export type ScannerDenomination = "10" | "20" | "50";

export type RelativeScanRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  priority: number;
};

export type AbsoluteScanRegion = {
  left: number;
  top: number;
  width: number;
  height: number;
  label: string;
  priority: number;
};

const REGION_PROFILES: Record<ScannerDenomination, RelativeScanRegion[]> = {
  "10": [
    { x: 0.52, y: 0.08, width: 0.42, height: 0.16, label: "Zona superior", priority: 1.1 },
    { x: 0.06, y: 0.76, width: 0.42, height: 0.16, label: "Zona inferior", priority: 1.05 }
  ],
  "20": [
    { x: 0.53, y: 0.09, width: 0.41, height: 0.16, label: "Zona superior", priority: 1.1 },
    { x: 0.07, y: 0.76, width: 0.41, height: 0.16, label: "Zona inferior", priority: 1.05 }
  ],
  "50": [
    { x: 0.52, y: 0.08, width: 0.43, height: 0.16, label: "Zona superior", priority: 1.08 },
    { x: 0.06, y: 0.76, width: 0.43, height: 0.16, label: "Zona inferior", priority: 1.05 }
  ]
};

const FALLBACK_REGION: RelativeScanRegion = {
  x: 0.06,
  y: 0.31,
  width: 0.88,
  height: 0.24,
  label: "Zona central",
  priority: 1
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function toAbsoluteRegion(relative: RelativeScanRegion, videoWidth: number, videoHeight: number): AbsoluteScanRegion {
  const left = Math.round(clamp(relative.x, 0, 0.95) * videoWidth);
  const top = Math.round(clamp(relative.y, 0, 0.95) * videoHeight);
  const width = Math.round(clamp(relative.width, 0.04, 0.98) * videoWidth);
  const height = Math.round(clamp(relative.height, 0.04, 0.98) * videoHeight);

  const safeWidth = Math.max(90, Math.min(width, videoWidth - left));
  const safeHeight = Math.max(42, Math.min(height, videoHeight - top));

  return {
    left,
    top,
    width: safeWidth,
    height: safeHeight,
    label: relative.label,
    priority: relative.priority
  };
}

export function buildScanRegions(denomination: ScannerDenomination, videoWidth: number, videoHeight: number) {
  const profile = REGION_PROFILES[denomination] ?? [];
  const source = [...profile, FALLBACK_REGION];

  return source.map((region) => toAbsoluteRegion(region, videoWidth, videoHeight));
}
