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

const GUIDE_KEY = "numicheck_scan_guide_seen_v1";
const QUALITY_SAMPLE_WIDTH = 148;
const QUALITY_SAMPLE_HEIGHT = 44;
const MIN_CONFIDENCE = 12;
const SNAP_FLASH_MS = 90;
const SUPER_TURBO_PREVIEW_MIN_CONFIDENCE = 40;
const SUPER_TURBO_MIN_EFFECTIVENESS = 60;
const TURBO_SECONDARY_WINDOW_MIN_MS = 380;
const TURBO_SECONDARY_WINDOW_MAX_MS = 1100;
const TURBO_SCAN_TOTAL_MIN_MS = 620;
const TURBO_SCAN_TOTAL_MAX_MS = 1700;
const MIN_QUALITY_TO_ATTEMPT_OCR = 18;
const SCANNER_ENGINE_VERSION = "Turbo v3";
const PRIMARY_ZONE_BY_DENOMINATION: Record<ScannerDenomination, string> = {
  "10": "Zona superior",
  "20": "Zona superior",
  "50": "Zona inferior"
};

function getOcrTargetSize(regionWidth: number, regionHeight: number, mode: "quick" | "deep") {
  if (mode === "quick") {
    const width = Math.max(132, Math.min(250, Math.round(regionWidth * 0.26)));
    const ratio = width / Math.max(1, regionWidth);
    const height = Math.max(42, Math.min(92, Math.round(regionHeight * ratio)));
    return { width, height };
  }

  const width = Math.max(270, Math.min(520, Math.round(regionWidth * 0.5)));
  const ratio = width / Math.max(1, regionWidth);
  const height = Math.max(64, Math.min(180, Math.round(regionHeight * ratio)));
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

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 720 },
            height: { ideal: 405 }
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
    setStatusText("Super turbo: capturando y leyendo...");
    setErrorText("");
    setScanFlash(true);
    window.setTimeout(() => setScanFlash(false), SNAP_FLASH_MS);

    let best: Candidate | null = null;
    let bestHint = "No se pudo leer el numero. Ajusta el encuadre e intenta de nuevo.";
    let observedQuality = 0;
    let observedConfidence = 0;
    let observedZone = "Zona central";
    let totalOcrMs = 0;
    let ocrCalls = 0;

    try {
      const scanStartedAt = performance.now();
      frameCanvas.width = video.videoWidth;
      frameCanvas.height = video.videoHeight;
      frameContext.drawImage(video, 0, 0, frameCanvas.width, frameCanvas.height);

      const regions =
        regionsRef.current.length > 0
          ? regionsRef.current
          : buildScanRegions(denomination, video.videoWidth, video.videoHeight);

      const quickRegions = getQuickRegionsForDenomination(denomination, regions);
      const quickAcceptConfidence = Math.max(MIN_CONFIDENCE, adaptiveThresholds.fastAcceptConfidence - 2);
      const immediateAcceptConfidence = Math.max(
        quickAcceptConfidence,
        adaptiveThresholds.immediateAcceptConfidence - 1
      );
      const secondaryWindowMs = Math.min(
        TURBO_SECONDARY_WINDOW_MAX_MS,
        Math.max(TURBO_SECONDARY_WINDOW_MIN_MS, deviceProfile.baseDelayMs + deviceProfile.readHitDelayMs + 520)
      );
      const maxScanMs = Math.min(
        TURBO_SCAN_TOTAL_MAX_MS,
        Math.max(TURBO_SCAN_TOTAL_MIN_MS, deviceProfile.baseDelayMs + deviceProfile.maxOcrMs + 120)
      );
      const ocrTimeoutMs = Math.min(980, Math.max(540, deviceProfile.maxOcrMs + 40));
      const tryQuickRegion = async (region: (typeof quickRegions)[number], regionIndex: number) => {
        setZoneLabel(region.label);
        observedZone = region.label;

        qualityCanvas.width = QUALITY_SAMPLE_WIDTH;
        qualityCanvas.height = QUALITY_SAMPLE_HEIGHT;
        qualityContext.drawImage(
          frameCanvas,
          region.left,
          region.top,
          region.width,
          region.height,
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

        if (!quality.isGood && quality.score < MIN_QUALITY_TO_ATTEMPT_OCR) {
          bestHint = `${region.label}: ${quality.hint}`;
          return false;
        }

        drawRegionForOcr(frameCanvas, canvas, region, "quick");

        const ocrStart = performance.now();
        const result = await recognizeWithTimeout(worker, canvas, ocrTimeoutMs);
        const ocrElapsed = Math.round(performance.now() - ocrStart);
        totalOcrMs += ocrElapsed;
        ocrCalls += 1;
        if (!result) {
          bestHint = `${region.label}: lectura lenta, vuelve a intentar.`;
          return false;
        }

        const text = result.data?.text ?? "";
        const confidence = Math.round(result.data?.confidence ?? 0);
        observedConfidence = Math.max(observedConfidence, confidence);

        const candidate = extractSerialDigitsFromOcr(text, digitBounds);

        if (!candidate || confidence < MIN_CONFIDENCE) {
          bestHint = `No legible en ${region.label}.`;
          return false;
        }

        const candidateScore = confidence * 0.62 + quality.score * 0.26 + region.priority * 10;
        const current: Candidate = {
          serial: candidate,
          confidence,
          quality: quality.score,
          score: candidateScore,
          zoneLabel: region.label,
          regionIndex
        };

        if (!best || current.score > best.score) {
          best = current;
        }

        const quickAccept = confidence >= quickAcceptConfidence;
        const immediateAccept =
          confidence >= immediateAcceptConfidence &&
          quality.score >= adaptiveThresholds.qualityAcceptFloor - 10;

        return quickAccept || immediateAccept;
      };

      const primaryRegion = quickRegions[0] ?? null;
      const secondaryRegion = quickRegions[1] ?? null;

      let acceptedInPrimary = false;
      if (primaryRegion) {
        acceptedInPrimary = await tryQuickRegion(primaryRegion, 0);
      }

      const bestConfidenceAfterPrimary = getCandidateConfidence(best);
      const elapsedAfterPrimary = performance.now() - scanStartedAt;
      if (
        !acceptedInPrimary &&
        secondaryRegion &&
        bestConfidenceAfterPrimary < quickAcceptConfidence &&
        elapsedAfterPrimary < secondaryWindowMs
      ) {
        await tryQuickRegion(secondaryRegion, 1);
      }

      const elapsedTotal = performance.now() - scanStartedAt;
      if (elapsedTotal > maxScanMs && !best) {
        bestHint = "No se pudo leer en modo turbo. Reintenta o usa subir imagen.";
      }

      const acceptedConfidence = getCandidateConfidence(best);
      const acceptedQuality = getCandidateQuality(best);
      const acceptedZone = getCandidateZoneLabel(best);
      const acceptedSerial = getCandidateSerial(best);
      const acceptedEffectiveness = Math.round(acceptedConfidence * 0.3 + acceptedQuality * 0.7);
      const hasAcceptedCandidate =
        acceptedSerial.length >= digitBounds.minDigits &&
        (acceptedConfidence >= SUPER_TURBO_PREVIEW_MIN_CONFIDENCE ||
          acceptedEffectiveness >= SUPER_TURBO_MIN_EFFECTIVENESS);

      if (hasAcceptedCandidate) {
        setLastConfidence(acceptedConfidence);
        setQualityScore(acceptedQuality);
        setZoneLabel(acceptedZone);
        setScanStatus("ready");
        setStatusText(`Turbo listo: "${acceptedSerial}" - B (${acceptedConfidence}%)`);

        recordScanSample(denomination, {
          ocrMs: ocrCalls > 0 ? Math.round(totalOcrMs / ocrCalls) : Math.min(deviceProfile.maxOcrMs, 420),
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
          hasCandidate
            ? `Lectura inestable (${acceptedConfidence}%). Reintenta para confirmar.`
            : bestHint
        );

        recordScanSample(denomination, {
          ocrMs: ocrCalls > 0 ? Math.round(totalOcrMs / ocrCalls) : Math.min(deviceProfile.maxOcrMs, 680),
          quality: finalQuality,
          confidence: finalConfidence,
          success: false,
          zoneLabel: finalZone
        });
      }
    } catch {
      setScanStatus("ready");
      setStatusText("Fallo de lectura. Intenta nuevamente.");
    } finally {
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
