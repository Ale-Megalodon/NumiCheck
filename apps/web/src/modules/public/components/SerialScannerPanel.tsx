import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../../app/providers/AuthProvider";
import { getSharedOcrWorker, subscribeOcrWarmup } from "../services/ocrWorkerStore";
import {
  getPublicUserSettings,
  subscribePublicUserSettings,
  type UserScanPatch
} from "../services/publicUserSettingsStore";
import { analyzeFrameQuality } from "../utils/frameQuality";
import {
  getAdaptiveThresholds,
  recordScanSample,
  sortZoneLabelsByTelemetry
} from "../utils/scanTelemetryStore";
import { mergeDeviceProfileWithPatch, resolveDeviceProfileForDenomination } from "../utils/deviceProfile";
import { buildScanRegions, type ScannerDenomination } from "../utils/scanRegionProfiles";
import { extractSerialDigitsFromOcr, type OcrDigitBounds } from "../utils/serialOcr";

type ScanStatus = "starting" | "ready" | "reading" | "error";

type OcrWorker = {
  recognize: (image: HTMLCanvasElement) => Promise<{ data?: { text?: string; confidence?: number } }>;
};

type SerialScannerPanelProps = {
  denomination: ScannerDenomination;
  denominationLabel: string;
  digitBounds: OcrDigitBounds;
  onDetected: (result: { serialDigits: string; confidence: number; quality: number }) => void;
  onClose: () => void;
};

type Candidate = {
  serial: string;
  confidence: number;
  quality: number;
  score: number;
  zoneLabel: string;
  regionIndex: number;
};

type CandidateVote = Candidate & {
  votes: number;
  firstSeenAt: number;
};

const GUIDE_KEY = "numicheck_scan_guide_seen_v1";
const QUALITY_SAMPLE_WIDTH = 148;
const QUALITY_SAMPLE_HEIGHT = 44;
const MIN_CONFIDENCE = 12;
const SNAP_FLASH_MS = 90;
const SUPER_TURBO_PREVIEW_MIN_CONFIDENCE = 18;
const SUPER_TURBO_MIN_EFFECTIVENESS = 46;
const TURBO_SECONDARY_WINDOW_MIN_MS = 380;
const TURBO_SECONDARY_WINDOW_MAX_MS = 1350;
const TURBO_SCAN_TOTAL_MIN_MS = 900;
const TURBO_SCAN_TOTAL_MAX_MS = 2600;
const MIN_QUALITY_TO_ATTEMPT_OCR = 14;
const SCANNER_ENGINE_VERSION = "Turbo v5";
const PRECAPTURE_WARMUP_FRAMES = 3;
const PRECAPTURE_FRAME_DELAY_MS = 38;
const BURST_CAPTURE_ATTEMPTS = 3;
const BURST_CAPTURE_DELAY_MS = 48;
const PASS_TWO_CAPTURE_ATTEMPTS = 2;
const OCR_QUALITY_CONFIDENCE_BOOST_FACTOR = 0.12;
const OCR_FULL_LENGTH_BONUS = 10;
const OCR_ALMOST_FULL_LENGTH_BONUS = 6;
const VOTE_ACCEPT_MIN_HITS = 2;
const FALLBACK_FINAL_PASSES = 2;
const PRIMARY_ZONE_BY_DENOMINATION: Record<ScannerDenomination, string> = {
  "10": "Zona superior",
  "20": "Zona superior",
  "50": "Zona inferior"
};

function getOcrTargetSize(regionWidth: number, regionHeight: number, mode: "quick" | "deep") {
  if (mode === "quick") {
    const width = Math.max(220, Math.min(420, Math.round(regionWidth * 0.56)));
    const ratio = width / Math.max(1, regionWidth);
    const height = Math.max(62, Math.min(136, Math.round(regionHeight * ratio)));
    return { width, height };
  }

  const width = Math.max(340, Math.min(680, Math.round(regionWidth * 0.84)));
  const ratio = width / Math.max(1, regionWidth);
  const height = Math.max(88, Math.min(220, Math.round(regionHeight * ratio)));
  return { width, height };
}

function getQuickRegionsForDenomination(
  denomination: ScannerDenomination,
  regions: ReturnType<typeof buildScanRegions>
) {
  if (regions.length <= 1) {
    return regions;
  }

  const preferredLabel = PRIMARY_ZONE_BY_DENOMINATION[denomination];
  const primary = regions.find((region) => region.label === preferredLabel) ?? regions[0];
  const secondary = regions.find((region) => region !== primary) ?? null;

  return secondary ? [primary, secondary] : [primary];
}

function getCandidateConfidence(candidate: Candidate | null) {
  return candidate ? candidate.confidence : 0;
}

function getCandidateQuality(candidate: Candidate | null) {
  return candidate ? candidate.quality : 0;
}

function getCandidateZoneLabel(candidate: Candidate | null) {
  return candidate ? candidate.zoneLabel : "Zona central";
}

function getCandidateSerial(candidate: Candidate | null) {
  return candidate ? candidate.serial : "";
}

function chooseBestCandidateFromVotes(voteMap: Map<string, CandidateVote>) {
  if (voteMap.size === 0) {
    return null;
  }

  const ordered = Array.from(voteMap.values()).sort((a, b) => {
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

function drawRegionForOcr(
  frameCanvas: HTMLCanvasElement,
  targetCanvas: HTMLCanvasElement,
  region: { left: number; top: number; width: number; height: number },
  mode: "quick" | "deep"
) {
  const context = targetCanvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("No se pudo preparar el contexto OCR.");
  }

  const size = getOcrTargetSize(region.width, region.height, mode);
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

  if (mode === "deep") {
    const image = context.getImageData(0, 0, size.width, size.height);
    const data = image.data;

    for (let i = 0; i < data.length; i += 4) {
      const gray = data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
      const boosted = gray > 152 ? 255 : gray < 96 ? 0 : gray;
      data[i] = boosted;
      data[i + 1] = boosted;
      data[i + 2] = boosted;
    }

    context.putImageData(image, 0, 0);
  }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function shiftRegion(
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

function boostConfidenceFromQuality(
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

async function recognizeWithTimeout(
  worker: OcrWorker,
  image: HTMLCanvasElement,
  timeoutMs: number
): Promise<{ data?: { text?: string; confidence?: number } } | null> {
  const timeoutPromise = new Promise<null>((resolve) => {
    window.setTimeout(() => resolve(null), timeoutMs);
  });

  return Promise.race([worker.recognize(image), timeoutPromise]);
}

export function SerialScannerPanel({
  denomination,
  denominationLabel,
  digitBounds,
  onDetected,
  onClose
}: SerialScannerPanelProps) {
  const { user } = useAuth();
  const [accountScanPatch, setAccountScanPatch] = useState<UserScanPatch>(() => getPublicUserSettings(user?.uid).scanPatch);

  useEffect(() => {
    const syncSettings = () => {
      setAccountScanPatch(getPublicUserSettings(user?.uid).scanPatch);
    };

    syncSettings();
    const unsubscribe = subscribePublicUserSettings(syncSettings);
    return unsubscribe;
  }, [user?.uid]);

  const profileResolution = useMemo(() => resolveDeviceProfileForDenomination(denomination), [denomination]);
  const deviceProfile = useMemo(
    () => mergeDeviceProfileWithPatch(profileResolution.profile, accountScanPatch),
    [accountScanPatch, profileResolution.profile]
  );
  const hasAccountPatch = useMemo(() => Object.keys(accountScanPatch).length > 0, [accountScanPatch]);
  const adaptiveThresholds = useMemo(
    () => getAdaptiveThresholds(denomination, deviceProfile),
    [denomination, deviceProfile]
  );

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const qualityCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const workerRef = useRef<OcrWorker | null>(null);
  const regionsRef = useRef<ReturnType<typeof buildScanRegions>>([]);

  const [scanStatus, setScanStatus] = useState<ScanStatus>("starting");
  const [statusText, setStatusText] = useState("Preparando camara...");
  const [errorText, setErrorText] = useState("");
  const [lastConfidence, setLastConfidence] = useState(0);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [showGuide, setShowGuide] = useState(false);
  const [qualityScore, setQualityScore] = useState(0);
  const [qualityLevel, setQualityLevel] = useState<"good" | "warn" | "bad">("warn");
  const [zoneLabel, setZoneLabel] = useState("Zona central");
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanFlash, setScanFlash] = useState(false);
  const [restartToken, setRestartToken] = useState(0);
  const [lastScanMs, setLastScanMs] = useState<number | null>(null);
  const [sessionScanAttempts, setSessionScanAttempts] = useState(0);
  const [sessionFirstTryHits, setSessionFirstTryHits] = useState(0);
  const sessionFirstTryRate = useMemo(() => {
    if (sessionScanAttempts <= 0) {
      return 0;
    }

    return Math.round((sessionFirstTryHits / sessionScanAttempts) * 100);
  }, [sessionFirstTryHits, sessionScanAttempts]);

  const stopMedia = () => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    trackRef.current = null;
    setTorchEnabled(false);
    setTorchSupported(false);
  };

  const detectTorchSupport = (track: MediaStreamTrack) => {
    try {
      const withCaps = track as MediaStreamTrack & { getCapabilities?: () => Record<string, unknown> };
      const capabilities = withCaps.getCapabilities?.();
      const torchRaw = (capabilities as Record<string, unknown> | undefined)?.torch;
      setTorchSupported(torchRaw === true);
    } catch {
      setTorchSupported(false);
    }
  };

  const toggleTorch = async () => {
    const track = trackRef.current;
    if (!track || !torchSupported) {
      return;
    }

    try {
      const next = !torchEnabled;
      const withTorch = track as MediaStreamTrack & {
        applyConstraints: (constraints: MediaTrackConstraints) => Promise<void>;
      };

      await withTorch.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet]
      });

      setTorchEnabled(next);
    } catch {
      setTorchSupported(false);
      setTorchEnabled(false);
    }
  };

  useEffect(() => {
    const alreadySeen = window.localStorage.getItem(GUIDE_KEY) === "1";
    setShowGuide(!alreadySeen);
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeOcrWarmup((progress, status) => {
      if (scanStatus === "starting") {
        setOcrProgress(progress);
        if (status && status !== "idle") {
          setStatusText(status);
        }
      }
    });

    return unsubscribe;
  }, [scanStatus]);

  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Tu navegador no soporta camara en vivo.");
        }

        setScanStatus("starting");
        setStatusText("Solicitando permiso de camara...");
        setErrorText("");
        setLastConfidence(0);
        setQualityScore(0);
        setZoneLabel("Zona central");
        setLastScanMs(null);

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        trackRef.current = stream.getVideoTracks()[0] ?? null;
        if (trackRef.current) {
          detectTorchSupport(trackRef.current);
        }

        const video = videoRef.current;

        if (!video) {
          throw new Error("No se pudo iniciar la vista de camara.");
        }

        video.srcObject = stream;
        await video.play();

        setStatusText("Preparando OCR...");
        workerRef.current = (await getSharedOcrWorker()) as OcrWorker;

        if (cancelled) {
          return;
        }

        const baseRegions = buildScanRegions(denomination, video.videoWidth, video.videoHeight);
        const labelsRanked = sortZoneLabelsByTelemetry(
          denomination,
          baseRegions.map((region) => region.label)
        );
        const rankMap = new Map(labelsRanked.map((label, index) => [label, index]));

        regionsRef.current = [...baseRegions].sort((a, b) => {
          const rankA = rankMap.get(a.label) ?? 99;
          const rankB = rankMap.get(b.label) ?? 99;
          if (rankA !== rankB) {
            return rankA - rankB;
          }
          return b.priority - a.priority;
        });

        setScanStatus("ready");
        setStatusText("Camara lista. Pulsa Escanear.");
      } catch (error) {
        const message = error instanceof Error ? error.message : "No se pudo iniciar el escaner.";
        setScanStatus("error");
        setErrorText(message);
      }
    };

    void boot();

    return () => {
      cancelled = true;
      stopMedia();
    };
  }, [denomination, restartToken]);

  const handleCloseGuide = () => {
    setShowGuide(false);
    window.localStorage.setItem(GUIDE_KEY, "1");
  };

  const handleRestartScan = () => {
    setRestartToken((prev) => prev + 1);
  };

  const handleScan = async () => {
    if (isScanning || scanStatus === "starting" || scanStatus === "error") {
      return;
    }

    if (showGuide) {
      setShowGuide(false);
      window.localStorage.setItem(GUIDE_KEY, "1");
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const qualityCanvas = qualityCanvasRef.current;
    const frameCanvas = frameCanvasRef.current;
    const worker = workerRef.current;

    if (
      !video ||
      !canvas ||
      !qualityCanvas ||
      !frameCanvas ||
      !worker ||
      video.videoWidth === 0 ||
      video.videoHeight === 0
    ) {
      setStatusText("Camara aun no lista. Espera un momento.");
      return;
    }

    const qualityContext = qualityCanvas.getContext("2d", { willReadFrequently: true });
    const frameContext = frameCanvas.getContext("2d", { willReadFrequently: true });

    if (!qualityContext || !frameContext) {
      setStatusText("No se pudo preparar la captura.");
      return;
    }

    setIsScanning(true);
    setScanStatus("reading");
    setStatusText("Super turbo: captura en rafaga...");
    setErrorText("");
    setScanFlash(true);
    window.setTimeout(() => setScanFlash(false), SNAP_FLASH_MS);

    let best: Candidate | null = null;
    let bestHint = "No se pudo leer el numero. Ajusta el encuadre e intenta de nuevo.";
    let observedQuality = 0;
    let observedConfidence = 0;
    let observedZone = "Zona central";
    let bestScore = Number.NEGATIVE_INFINITY;
    let totalOcrMs = 0;
    let ocrCalls = 0;
    let firstPassHitForMetrics = false;

    try {
      const scanStartedAt = performance.now();
      frameCanvas.width = video.videoWidth;
      frameCanvas.height = video.videoHeight;

      const regions =
        regionsRef.current.length > 0
          ? regionsRef.current
          : buildScanRegions(denomination, video.videoWidth, video.videoHeight);

      const quickRegions = getQuickRegionsForDenomination(denomination, regions);
      const quickAcceptConfidence = Math.max(MIN_CONFIDENCE, adaptiveThresholds.fastAcceptConfidence - 10);
      const immediateAcceptConfidence = Math.max(
        quickAcceptConfidence,
        adaptiveThresholds.immediateAcceptConfidence - 8
      );
      const voteAcceptConfidence = Math.max(MIN_CONFIDENCE + 8, quickAcceptConfidence - 8);
      const qualityAcceptFloor = Math.max(42, adaptiveThresholds.qualityAcceptFloor - 16);
      const secondaryWindowMs = Math.min(
        TURBO_SECONDARY_WINDOW_MAX_MS,
        Math.max(TURBO_SECONDARY_WINDOW_MIN_MS, deviceProfile.baseDelayMs + deviceProfile.readHitDelayMs + 540)
      );
      const maxScanMs = Math.min(
        TURBO_SCAN_TOTAL_MAX_MS,
        Math.max(TURBO_SCAN_TOTAL_MIN_MS, deviceProfile.baseDelayMs + deviceProfile.maxOcrMs + 880)
      );
      const quickOcrTimeoutMs = clamp(deviceProfile.maxOcrMs + 140, 560, 1050);
      const deepOcrTimeoutMs = clamp(deviceProfile.maxOcrMs + 360, 900, 1550);
      const horizontalOffsets = [0, -0.018, 0.018, -0.032, 0.032];
      const voteMap = new Map<string, CandidateVote>();

      const registerCandidateVote = (candidate: Candidate, burstIndex: number) => {
        const existing = voteMap.get(candidate.serial);
        if (!existing) {
          voteMap.set(candidate.serial, {
            ...candidate,
            votes: 1,
            firstSeenAt: burstIndex
          });
          return 1;
        }

        const nextVotes = existing.votes + 1;
        const improved =
          candidate.score > existing.score ||
          candidate.confidence > existing.confidence ||
          candidate.quality > existing.quality;
        voteMap.set(candidate.serial, {
          ...(improved ? candidate : existing),
          votes: nextVotes,
          firstSeenAt: existing.firstSeenAt
        });
        return nextVotes;
      };

      const tryRegionRead = async (
        region: (typeof quickRegions)[number],
        regionIndex: number,
        burstIndex: number,
        mode: "quick" | "deep",
        passIndex: number
      ) => {
        const shifted = shiftRegion(
          region,
          frameCanvas.width,
          frameCanvas.height,
          horizontalOffsets[burstIndex % horizontalOffsets.length] ?? 0
        );

        setZoneLabel(region.label);
        observedZone = region.label;

        qualityCanvas.width = QUALITY_SAMPLE_WIDTH;
        qualityCanvas.height = QUALITY_SAMPLE_HEIGHT;
        qualityContext.drawImage(
          frameCanvas,
          shifted.left,
          shifted.top,
          shifted.width,
          shifted.height,
          0,
          0,
          QUALITY_SAMPLE_WIDTH,
          QUALITY_SAMPLE_HEIGHT
        );

        const qualityPixels = qualityContext.getImageData(0, 0, QUALITY_SAMPLE_WIDTH, QUALITY_SAMPLE_HEIGHT);
        const quality = analyzeFrameQuality(qualityPixels.data, QUALITY_SAMPLE_WIDTH, QUALITY_SAMPLE_HEIGHT, null);

        observedQuality = Math.max(observedQuality, quality.score);
        setQualityScore(quality.score);
        setQualityLevel(quality.level);

        if (mode === "quick" && !quality.isGood && quality.score < MIN_QUALITY_TO_ATTEMPT_OCR) {
          bestHint = `${region.label}: ${quality.hint}`;
          return false;
        }

        drawRegionForOcr(frameCanvas, canvas, shifted, mode);

        const ocrStart = performance.now();
        const result = await recognizeWithTimeout(worker, canvas, mode === "quick" ? quickOcrTimeoutMs : deepOcrTimeoutMs);
        const ocrElapsed = Math.round(performance.now() - ocrStart);
        totalOcrMs += ocrElapsed;
        ocrCalls += 1;
        if (!result) {
          bestHint = `${region.label}: lectura lenta en modo ${mode}.`;
          return false;
        }

        const text = result.data?.text ?? "";
        const rawConfidence = Math.round(result.data?.confidence ?? 0);
        const candidate = extractSerialDigitsFromOcr(text, digitBounds);

        if (!candidate) {
          observedConfidence = Math.max(observedConfidence, rawConfidence);
          bestHint = `No legible en ${region.label}.`;
          return false;
        }

        const confidence = boostConfidenceFromQuality(
          rawConfidence,
          quality.score,
          candidate.length,
          digitBounds.maxDigits
        );
        const boostedConfidence = mode === "deep" ? clamp(confidence + 4, MIN_CONFIDENCE, 99) : confidence;
        observedConfidence = Math.max(observedConfidence, boostedConfidence);

        if (boostedConfidence < MIN_CONFIDENCE) {
          bestHint = `No legible en ${region.label}.`;
          return false;
        }

        const candidateScore =
          boostedConfidence * 0.64 +
          quality.score * 0.3 +
          region.priority * 10 -
          burstIndex * 1.4 +
          (mode === "deep" ? 2 : 0) +
          (passIndex === 2 ? 1 : 0);
        const current: Candidate = {
          serial: candidate,
          confidence: boostedConfidence,
          quality: quality.score,
          score: candidateScore,
          zoneLabel: region.label,
          regionIndex
        };

        if (!best || current.score > best.score) {
          best = current;
          bestScore = current.score;
        }
        const votes = registerCandidateVote(current, burstIndex + passIndex * 10);

        const quickAccept = boostedConfidence >= quickAcceptConfidence;
        const immediateAccept = boostedConfidence >= immediateAcceptConfidence && quality.score >= qualityAcceptFloor;
        const voteAccept = votes >= VOTE_ACCEPT_MIN_HITS && boostedConfidence >= voteAcceptConfidence;
        const deepModeAccept =
          mode === "deep" &&
          boostedConfidence >= voteAcceptConfidence - 6 &&
          quality.score >= Math.max(38, qualityAcceptFloor - 8);

        return quickAccept || immediateAccept || voteAccept || deepModeAccept;
      };

      const primaryRegion = quickRegions[0] ?? null;
      const secondaryRegion = quickRegions[1] ?? null;

      const runPass = async (passIndex: 1 | 2, mode: "quick" | "deep", attempts: number) => {
        for (let burstIndex = 0; burstIndex < attempts; burstIndex += 1) {
          if (performance.now() - scanStartedAt >= maxScanMs) {
            break;
          }

          frameContext.drawImage(video, 0, 0, frameCanvas.width, frameCanvas.height);
          let acceptedInFrame = false;

          if (primaryRegion) {
            acceptedInFrame = await tryRegionRead(primaryRegion, 0, burstIndex, mode, passIndex);
          }

          const elapsedAfterPrimary = performance.now() - scanStartedAt;
          const bestConfidenceAfterPrimary = getCandidateConfidence(best);
          if (
            !acceptedInFrame &&
            secondaryRegion &&
            bestConfidenceAfterPrimary < quickAcceptConfidence &&
            elapsedAfterPrimary < secondaryWindowMs + (passIndex === 2 ? 220 : 0)
          ) {
            acceptedInFrame = await tryRegionRead(secondaryRegion, 1, burstIndex, mode, passIndex);
          }

          if (
            !acceptedInFrame &&
            mode === "quick" &&
            primaryRegion &&
            bestConfidenceAfterPrimary < quickAcceptConfidence - 6
          ) {
            acceptedInFrame = await tryRegionRead(primaryRegion, 0, burstIndex, "deep", passIndex);
          }

          if (acceptedInFrame) {
            return true;
          }

          if (burstIndex < attempts - 1) {
            await delay(BURST_CAPTURE_DELAY_MS);
          }
        }

        return false;
      };

      setStatusText("Super turbo: estabilizando enfoque...");
      for (let frameIndex = 0; frameIndex < PRECAPTURE_WARMUP_FRAMES; frameIndex += 1) {
        frameContext.drawImage(video, 0, 0, frameCanvas.width, frameCanvas.height);
        if (frameIndex < PRECAPTURE_WARMUP_FRAMES - 1) {
          await delay(PRECAPTURE_FRAME_DELAY_MS);
        }
      }

      setStatusText("Super turbo: pase 1...");
      const acceptedInPassOne = await runPass(1, "quick", BURST_CAPTURE_ATTEMPTS);
      let acceptedOverall = acceptedInPassOne;

      if (!acceptedOverall && performance.now() - scanStartedAt < maxScanMs) {
        setStatusText("Super turbo: pase 2 automatico...");
        acceptedOverall = await runPass(2, "deep", PASS_TWO_CAPTURE_ATTEMPTS);
      }

      if (!acceptedOverall && performance.now() - scanStartedAt < maxScanMs) {
        setStatusText("Super turbo: rescate final...");
        const fallbackRegion = {
          left: Math.round(frameCanvas.width * 0.05),
          top: Math.round(frameCanvas.height * 0.28),
          width: Math.round(frameCanvas.width * 0.9),
          height: Math.round(frameCanvas.height * 0.3),
          label: "Zona completa",
          priority: 0.94
        };

        for (let fallbackIndex = 0; fallbackIndex < FALLBACK_FINAL_PASSES; fallbackIndex += 1) {
          frameContext.drawImage(video, 0, 0, frameCanvas.width, frameCanvas.height);
          const rescued = await tryRegionRead(fallbackRegion, 2, fallbackIndex, "deep", 2);
          if (rescued) {
            acceptedOverall = true;
            break;
          }

          if (fallbackIndex < FALLBACK_FINAL_PASSES - 1) {
            await delay(BURST_CAPTURE_DELAY_MS + 16);
          }
        }
      }

      const votedCandidate = chooseBestCandidateFromVotes(voteMap);
      if (
        votedCandidate &&
        (votedCandidate.votes >= VOTE_ACCEPT_MIN_HITS || votedCandidate.score >= bestScore - 6)
      ) {
        best = {
          serial: votedCandidate.serial,
          confidence: votedCandidate.confidence,
          quality: votedCandidate.quality,
          score: votedCandidate.score,
          zoneLabel: votedCandidate.zoneLabel,
          regionIndex: votedCandidate.regionIndex
        };
        bestScore = votedCandidate.score;
      }

      const elapsedTotal = Math.round(performance.now() - scanStartedAt);
      setLastScanMs(elapsedTotal);
      if (elapsedTotal > maxScanMs && !best) {
        bestHint = "No se pudo leer en modo turbo. Reintenta o usa subir imagen.";
      }

      const acceptedConfidence = getCandidateConfidence(best);
      const acceptedQuality = getCandidateQuality(best);
      const acceptedZone = getCandidateZoneLabel(best);
      const acceptedSerial = getCandidateSerial(best);
      const acceptedVotes = acceptedSerial ? (voteMap.get(acceptedSerial)?.votes ?? 0) : 0;
      const acceptedEffectiveness = Math.round(acceptedConfidence * 0.22 + acceptedQuality * 0.78);
      const hasAcceptedCandidate =
        acceptedSerial.length >= digitBounds.minDigits &&
        (acceptedOverall ||
          acceptedVotes >= VOTE_ACCEPT_MIN_HITS ||
          acceptedConfidence >= SUPER_TURBO_PREVIEW_MIN_CONFIDENCE ||
          acceptedEffectiveness >= SUPER_TURBO_MIN_EFFECTIVENESS);
      const hasSoftAcceptedCandidate =
        acceptedSerial.length >= digitBounds.minDigits &&
        (acceptedConfidence >= MIN_CONFIDENCE + 2 || acceptedQuality >= 38 || acceptedVotes >= 1);
      const shouldEmitCandidate = hasAcceptedCandidate || hasSoftAcceptedCandidate;

      if (shouldEmitCandidate) {
        firstPassHitForMetrics = acceptedInPassOne;
        setLastConfidence(acceptedConfidence);
        setQualityScore(acceptedQuality);
        setZoneLabel(acceptedZone);
        setScanStatus("ready");
        setStatusText(
          `Turbo listo en ${elapsedTotal}ms: "${acceptedSerial}" - B (${acceptedConfidence}%, votos ${acceptedVotes})`
        );

        recordScanSample(denomination, {
          ocrMs: ocrCalls > 0 ? Math.round(totalOcrMs / ocrCalls) : Math.min(deviceProfile.maxOcrMs, 380),
          quality: acceptedQuality,
          confidence: acceptedConfidence,
          success: true,
          zoneLabel: acceptedZone
        });

        if (typeof navigator.vibrate === "function") {
          navigator.vibrate(18);
        }

        onDetected({
          serialDigits: acceptedSerial,
          confidence: acceptedConfidence,
          quality: acceptedQuality
        });
      } else {
        const hasCandidate = acceptedSerial.length > 0;
        const finalConfidence = hasCandidate ? Math.max(observedConfidence, acceptedConfidence) : observedConfidence;
        const finalQuality = hasCandidate ? Math.max(observedQuality, acceptedQuality) : observedQuality;
        const finalZone = hasCandidate ? acceptedZone : observedZone;

        setLastConfidence(finalConfidence);
        setScanStatus("ready");
        setStatusText(
          hasCandidate ? `Lectura inestable (${acceptedConfidence}%). Reintenta para confirmar.` : bestHint
        );

        recordScanSample(denomination, {
          ocrMs: ocrCalls > 0 ? Math.round(totalOcrMs / ocrCalls) : Math.min(deviceProfile.maxOcrMs, 560),
          quality: finalQuality,
          confidence: finalConfidence,
          success: false,
          zoneLabel: finalZone
        });
      }
    } catch {
      setScanStatus("ready");
      setStatusText("Fallo de lectura. Intenta nuevamente.");
      setLastScanMs(null);
    } finally {
      setSessionScanAttempts((prev) => prev + 1);
      if (firstPassHitForMetrics) {
        setSessionFirstTryHits((prev) => prev + 1);
      }
      setIsScanning(false);
    }
  };

  return (
    <section className="scanner-panel" aria-label="Escaner de numero de serie">
      <header className="scanner-header">
        <div>
          <h2>{`Escaner rapido - ${SCANNER_ENGINE_VERSION}`}</h2>
          <p>Detecta automaticamente serie B para {denominationLabel}</p>
        </div>
        <div className="scanner-header-actions">
          <span className="scanner-version-badge">{SCANNER_ENGINE_VERSION}</span>
          <span className="scanner-tier-badge">
            {deviceProfile.tier.toUpperCase()} / {hasAccountPatch ? "CUENTA" : profileResolution.source.toUpperCase()}
          </span>
          <button type="button" className="scanner-close" onClick={onClose} aria-label="Cerrar escaner">
            X
          </button>
        </div>
      </header>

      <div className="scanner-viewport">
        <video ref={videoRef} className="scanner-video" muted autoPlay playsInline />

        <div className="scanner-overlay" aria-hidden="true">
          <div className="scanner-target">
            <span>Alinea aqui el numero de serie</span>
          </div>
        </div>

        {scanStatus === "starting" ? <div className="scanner-loading skeleton" aria-hidden="true" /> : null}
        {scanFlash ? <div className="scanner-snap-flash" aria-hidden="true" /> : null}
      </div>

      <div className="scanner-quality" aria-label="Calidad de lectura">
        <div className="scanner-quality-track">
          <span
            className={`scanner-quality-fill scanner-quality-fill--${qualityLevel}`}
            style={{ width: `${Math.max(8, qualityScore)}%` }}
          />
        </div>
        <span className="scanner-quality-text">Calidad: {qualityScore}%</span>
      </div>

      <div className="scanner-actions-row">
        <button
          type="button"
          className="scanner-scan-primary"
          onClick={() => void handleScan()}
          disabled={isScanning || scanStatus === "starting"}
        >
          {isScanning ? "Escaneando..." : "Escanear"}
        </button>

        {torchSupported ? (
          <button
            type="button"
            className={`scanner-secondary ${torchEnabled ? "scanner-secondary--active" : ""}`}
            onClick={() => void toggleTorch()}
          >
            {torchEnabled ? "Luz encendida" : "Encender luz"}
          </button>
        ) : (
          <div className="scanner-secondary scanner-secondary--ghost">Luz no disponible</div>
        )}

        <button type="button" className="scanner-secondary" onClick={handleRestartScan}>
          Reiniciar escaneo
        </button>
      </div>

      <div className="scanner-status-stack">
        <p className="scanner-zone-label">{zoneLabel}</p>
        <p className="scanner-status">{statusText}</p>
        {scanStatus === "starting" ? <p className="scanner-progress">Cargando OCR... {ocrProgress}%</p> : null}
        {lastConfidence > 0 ? <p className="scanner-progress">Confianza OCR: {lastConfidence}%</p> : null}
        {lastScanMs !== null ? <p className="scanner-progress">Tiempo de lectura: {lastScanMs}ms</p> : null}
        {sessionScanAttempts > 0 ? (
          <p className="scanner-progress">
            Primer intento (sesion): {sessionFirstTryRate}% ({sessionFirstTryHits}/{sessionScanAttempts})
          </p>
        ) : null}
        {errorText ? <p className="manual-error">{errorText}</p> : null}
      </div>

      <canvas ref={canvasRef} className="scanner-canvas-hidden" aria-hidden="true" />
      <canvas ref={qualityCanvasRef} className="scanner-canvas-hidden" aria-hidden="true" />
      <canvas ref={frameCanvasRef} className="scanner-canvas-hidden" aria-hidden="true" />

      {showGuide ? (
        <div className="scanner-guide-overlay" role="dialog" aria-modal="true">
          <article className="scanner-guide-card">
            <h3>Guia rapida de escaneo</h3>
            <p>1. Usa buena luz y evita reflejos.</p>
            <p>2. Alinea solo el numero de serie en el recuadro.</p>
            <p>3. Manten el telefono quieto 1-2 segundos.</p>
            <button type="button" className="manual-submit" onClick={handleCloseGuide}>
              Entendido
            </button>
          </article>
        </div>
      ) : null}
    </section>
  );
}
