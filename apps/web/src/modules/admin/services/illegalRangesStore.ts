export type Denomination = "10" | "20" | "50";

export type IllegalRange = {
  id: string;
  start: number;
  end: number;
  active: boolean;
};

export type IllegalRangesByDenomination = Record<Denomination, IllegalRange[]>;

type RangeTuple = [number, number];

type ValidationOutcome = {
  status: "illegal" | "legal" | "invalid";
  reason: string;
  matchedRange?: IllegalRange;
};

type SerialDigitBounds = {
  minDigits: number;
  maxDigits: number;
};

const STORAGE_KEY = "numicheck_illegal_ranges_v1";

const DEFAULT_RANGES: Record<Denomination, RangeTuple[]> = {
  "10": [
    [77100001, 77550000],
    [78000001, 78450000],
    [78900001, 96350000],
    [96350001, 96800000],
    [96800001, 97250000],
    [98150001, 98600000],
    [104900001, 105350000],
    [105350001, 105800000],
    [106700001, 107150000],
    [107600001, 108050000],
    [108050001, 108500000],
    [109400001, 109850000]
  ],
  "20": [
    [87280145, 91646549],
    [96650001, 97100000],
    [99800001, 100250000],
    [100250001, 100700000],
    [109250001, 109700000],
    [110600001, 111050000],
    [111050001, 111500000],
    [111950001, 112400000],
    [112400001, 112850000],
    [112850001, 113300000],
    [114200001, 114650000],
    [114650001, 115100000],
    [115100001, 115550000],
    [118700001, 119150000],
    [119150001, 119600000],
    [120500001, 120950000]
  ],
  "50": [
    [67250001, 67700000],
    [69050001, 69500000],
    [69500001, 69950000],
    [69950001, 70400000],
    [70400001, 70850000],
    [70850001, 71300000],
    [76310012, 85139995],
    [86400001, 86850000],
    [90900001, 91350000],
    [91800001, 92250000]
  ]
};

function buildDefaultRanges(): IllegalRangesByDenomination {
  const result: IllegalRangesByDenomination = { "10": [], "20": [], "50": [] };

  (Object.keys(DEFAULT_RANGES) as Denomination[]).forEach((denomination) => {
    result[denomination] = DEFAULT_RANGES[denomination].map(([start, end], index) => ({
      id: `${denomination}-${index + 1}`,
      start,
      end,
      active: true
    }));
  });

  return result;
}

function normalizeRows(rows: IllegalRange[]): IllegalRange[] {
  return rows
    .map((row, index) => ({
      id: row.id || `row-${index + 1}`,
      start: Number.isFinite(row.start) ? Math.trunc(row.start) : 0,
      end: Number.isFinite(row.end) ? Math.trunc(row.end) : 0,
      active: row.active !== false
    }))
    .sort((a, b) => a.start - b.start);
}

function readStore(): IllegalRangesByDenomination {
  const defaults = buildDefaultRanges();

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return defaults;
    }

    const parsed = JSON.parse(raw) as Partial<IllegalRangesByDenomination>;
    return {
      "10": normalizeRows(parsed["10"] ?? defaults["10"]),
      "20": normalizeRows(parsed["20"] ?? defaults["20"]),
      "50": normalizeRows(parsed["50"] ?? defaults["50"])
    };
  } catch {
    return defaults;
  }
}

function writeStore(data: IllegalRangesByDenomination) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function getIllegalRanges(): IllegalRangesByDenomination {
  return readStore();
}

export function saveIllegalRanges(data: IllegalRangesByDenomination) {
  writeStore({
    "10": normalizeRows(data["10"]),
    "20": normalizeRows(data["20"]),
    "50": normalizeRows(data["50"])
  });
}

export function resetIllegalRangesToDefault(): IllegalRangesByDenomination {
  const defaults = buildDefaultRanges();
  writeStore(defaults);
  return defaults;
}

export function createIllegalRange(start = 0, end = 0): IllegalRange {
  const randomId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id: randomId,
    start,
    end,
    active: true
  };
}

export function getSerialDigitBounds(denomination: Denomination): SerialDigitBounds {
  const rows = getIllegalRanges()[denomination];
  const digitLengths = rows.flatMap((row) => [
    String(Math.abs(Math.trunc(row.start))).length,
    String(Math.abs(Math.trunc(row.end))).length
  ]);

  if (digitLengths.length === 0) {
    return { minDigits: 1, maxDigits: 10 };
  }

  return {
    minDigits: Math.max(1, Math.min(...digitLengths)),
    maxDigits: Math.max(...digitLengths)
  };
}

export function evaluateSeriesAgainstIllegalRanges(
  denomination: Denomination,
  serialInput: string
): ValidationOutcome {
  const normalized = serialInput.trim().toUpperCase().replace(/\s+/g, "");
  const match = normalized.match(/^(\d+)([A-Z])$/);

  if (!match) {
    return {
      status: "invalid",
      reason: "Formato invalido. Usa numero seguido de letra. Ej: 123456789B"
    };
  }

  const serialNumber = Number(match[1]);
  const seriesLetter = match[2];

  if (!Number.isFinite(serialNumber)) {
    return {
      status: "invalid",
      reason: "Numero de serie invalido."
    };
  }

  if (seriesLetter !== "B") {
    return {
      status: "legal",
      reason: "Solo se controla la serie B."
    };
  }

  const ranges = getIllegalRanges()[denomination].filter((range) => range.active);
  const matchedRange = ranges.find((range) => serialNumber >= range.start && serialNumber <= range.end);

  if (matchedRange) {
    return {
      status: "illegal",
      reason: "Numero dentro de rango inhabilitado.",
      matchedRange
    };
  }

  return {
    status: "legal",
    reason: "No coincide con rangos inhabilitados para esa denominacion."
  };
}
