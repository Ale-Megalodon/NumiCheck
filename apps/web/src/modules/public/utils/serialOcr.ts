export type OcrDigitBounds = {
  minDigits: number;
  maxDigits: number;
};

function clampBounds(bounds: OcrDigitBounds): OcrDigitBounds {
  const maxDigits = Math.max(1, Math.min(12, Math.trunc(bounds.maxDigits)));
  const minDigits = Math.max(1, Math.min(maxDigits, Math.trunc(bounds.minDigits)));
  return { minDigits, maxDigits };
}

function normalizeDigits(raw: string): string {
  return raw
    .replace(/[OQ]/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/Z/g, "2")
    .replace(/S/g, "5")
    .replace(/[^0-9]/g, "");
}

function pickBest(candidates: string[], maxDigits: number): string | null {
  if (candidates.length === 0) {
    return null;
  }

  const unique = Array.from(new Set(candidates));
  unique.sort((a, b) => {
    if (b.length !== a.length) {
      return b.length - a.length;
    }
    return Math.abs(maxDigits - a.length) - Math.abs(maxDigits - b.length);
  });

  return unique[0] ?? null;
}

export function extractSerialDigitsFromOcr(ocrText: string, boundsInput: OcrDigitBounds): string | null {
  const bounds = clampBounds(boundsInput);
  const source = ocrText.toUpperCase();
  const safe = source.replace(/[^A-Z0-9]/g, " ").replace(/\s+/g, " ").trim();

  if (!safe) {
    return null;
  }

  const candidates: string[] = [];
  const withTrailingB = new RegExp(`([A-Z0-9]{${bounds.minDigits},${bounds.maxDigits}})\\s*B`, "g");
  const withLeadingB = new RegExp(`B\\s*([A-Z0-9]{${bounds.minDigits},${bounds.maxDigits}})`, "g");
  const genericDigits = new RegExp(`([A-Z0-9]{${bounds.minDigits},${bounds.maxDigits}})`, "g");

  for (const regex of [withTrailingB, withLeadingB]) {
    let match = regex.exec(safe);
    while (match) {
      const normalized = normalizeDigits(match[1] ?? "");
      if (normalized.length >= bounds.minDigits && normalized.length <= bounds.maxDigits) {
        candidates.push(normalized);
      }
      match = regex.exec(safe);
    }
  }

  if (candidates.length > 0) {
    return pickBest(candidates, bounds.maxDigits);
  }

  if (safe.includes("B")) {
    let match = genericDigits.exec(safe);
    while (match) {
      const normalized = normalizeDigits(match[1] ?? "");
      if (normalized.length >= bounds.minDigits && normalized.length <= bounds.maxDigits) {
        candidates.push(normalized);
      }
      match = genericDigits.exec(safe);
    }
  }

  return pickBest(candidates, bounds.maxDigits);
}
