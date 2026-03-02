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

function normalizeForDigitRuns(raw: string): string {
  return raw
    .replace(/[OQ]/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/Z/g, "2")
    .replace(/S/g, "5");
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

function collectLongRunSlices(run: string, minDigits: number, maxDigits: number) {
  const results: string[] = [];
  if (run.length < minDigits) {
    return results;
  }

  if (run.length <= maxDigits) {
    results.push(run);
    return results;
  }

  for (let length = maxDigits; length >= minDigits; length -= 1) {
    results.push(run.slice(0, length));
    results.push(run.slice(run.length - length));
  }

  return results;
}

export function extractSerialCandidatesFromOcr(ocrText: string, boundsInput: OcrDigitBounds): string[] {
  const bounds = clampBounds(boundsInput);
  const source = ocrText.toUpperCase();
  const safe = source.replace(/[^A-Z0-9]/g, " ").replace(/\s+/g, " ").trim();

  if (!safe) {
    return [];
  }

  const candidates: string[] = [];
  const withTrailingLetter = new RegExp(`([A-Z0-9]{${bounds.minDigits},${bounds.maxDigits}})\\s*[A-Z]`, "g");
  const withLeadingB = new RegExp(`B\\s*([A-Z0-9]{${bounds.minDigits},${bounds.maxDigits}})`, "g");
  const genericDigits = new RegExp(`([A-Z0-9]{${bounds.minDigits},${bounds.maxDigits}})`, "g");

  for (const regex of [withTrailingLetter, withLeadingB]) {
    let match = regex.exec(safe);
    while (match) {
      const normalized = normalizeDigits(match[1] ?? "");
      if (normalized.length >= bounds.minDigits && normalized.length <= bounds.maxDigits) {
        candidates.push(normalized);
      }
      match = regex.exec(safe);
    }
  }

  const normalizedRunsSource = normalizeForDigitRuns(source);
  const digitRuns = (normalizedRunsSource.match(/\d+/g) ?? []).map((run) => run.trim()).filter(Boolean);

  digitRuns.forEach((run) => {
    for (const sliced of collectLongRunSlices(run, bounds.minDigits, bounds.maxDigits)) {
      const normalized = normalizeDigits(sliced);
      if (normalized.length >= bounds.minDigits && normalized.length <= bounds.maxDigits) {
        candidates.push(normalized);
      }
    }
  });

  for (let index = 0; index < digitRuns.length; index += 1) {
    const pair = `${digitRuns[index] ?? ""}${digitRuns[index + 1] ?? ""}`;
    if (pair.length >= bounds.minDigits && pair.length <= bounds.maxDigits) {
      candidates.push(pair);
    }

    const triple = `${digitRuns[index] ?? ""}${digitRuns[index + 1] ?? ""}${digitRuns[index + 2] ?? ""}`;
    if (triple.length >= bounds.minDigits && triple.length <= bounds.maxDigits) {
      candidates.push(triple);
    }
  }

  let match = genericDigits.exec(safe);
  while (match) {
    const normalized = normalizeDigits(match[1] ?? "");
    if (normalized.length >= bounds.minDigits && normalized.length <= bounds.maxDigits) {
      candidates.push(normalized);
    }
    match = genericDigits.exec(safe);
  }

  const unique = Array.from(new Set(candidates));
  unique.sort((a, b) => {
    if (b.length !== a.length) {
      return b.length - a.length;
    }
    return Math.abs(bounds.maxDigits - a.length) - Math.abs(bounds.maxDigits - b.length);
  });

  return unique;
}

export function extractSerialDigitsFromOcr(ocrText: string, boundsInput: OcrDigitBounds): string | null {
  const bounds = clampBounds(boundsInput);
  const candidates = extractSerialCandidatesFromOcr(ocrText, bounds);
  return pickBest(candidates, bounds.maxDigits);
}
