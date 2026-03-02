import { useEffect, useMemo, useRef, useState } from "react";
import { getSharedOcrWorker, subscribeOcrWarmup } from "../services/ocrWorkerStore";
import { analyzeFrameQuality } from "../utils/frameQuality";
import {
  getAdaptiveThresholds,
  recordScanSample,
  sortZoneLabelsByTelemetry
} from "../utils/scanTelemetryStore";
import { resolveDeviceProfileForDenomination } from "../utils/deviceProfile";
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
  onDetected: (serialDigits: string) => void;
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
const QUALITY_SAMPLE_WIDTH = 176;
const QUALITY_SAMPLE_HEIGHT = 52;
const MIN_CONFIDENCE = 34;
const SNAP_FLASH_MS = 120;
const PRIMARY_ZONE_BY_DENOMINATION: Record<ScannerDenomination, string> = {
  "10": "Zona superior",
  "20": "Zona superior",
  "50": "Zona inferior"
};

function getOcrTargetSize(regionWidth: number, regionHeight: number, mode: "quick" | "deep") {
  if (mode === "quick") {
    const width = Math.max(220, Math.min(420, Math.round(regionWidth * 0.42)));
    const ratio = width / Math.max(1, regionWidth);
    const height = Math.max(58, Math.min(150, Math.round(regionHeight * ratio)));
    return { width, height };
  }

  const width = Math.max(300, Math.min(620, Math.round(regionWidth * 0.58)));
  const ratio = width / Math.max(1, regionWidth);
  const height = Math.max(70, Math.min(210, Math.round(regionHeight * ratio)));
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

function getCandidateRegionIndex(candidate: Candidate | null) {
  return candidate ? candidate.regionIndex : 0;
}

function getCandidateScore(candidate: Candidate | null) {
  return candidate ? candidate.score : Number.NEGATIVE_INFINITY;
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

export function SerialScannerPanel({
  denomination,
  denominationLabel,
  digitBounds,
  onDetected,
  onClose
}: SerialScannerPanelProps) {
  const profileResolution = useMemo(() => resolveDeviceProfileForDenomination(denomination), [denomination]);
  const deviceProfile = profileResolution.profile;
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
      setStatusText("Cierra la guia y luego pulsa Escanear.");
      return;
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
    setStatusText("Tomando foto y analizando...");
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
      frameCanvas.width = video.videoWidth;
      frameCanvas.height = video.videoHeight;
      frameContext.drawImage(video, 0, 0, frameCanvas.width, frameCanvas.height);

      const regions =
        regionsRef.current.length > 0
          ? regionsRef.current
          : buildScanRegions(denomination, video.videoWidth, video.videoHeight);

      const quickRegions = getQuickRegionsForDenomination(denomination, regions);
      const quickAcceptConfidence = Math.max(MIN_CONFIDENCE + 8, adaptiveThresholds.fastAcceptConfidence - 8);
      const deepAcceptConfidence = Math.max(MIN_CONFIDENCE + 3, adaptiveThresholds.fastAcceptConfidence - 3);
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

        if (!quality.isGood) {
          bestHint = `${region.label}: ${quality.hint}`;
          return false;
        }

        drawRegionForOcr(frameCanvas, canvas, region, "quick");

        const ocrStart = performance.now();
        const result = await worker.recognize(canvas);
        const ocrElapsed = Math.round(performance.now() - ocrStart);
        totalOcrMs += ocrElapsed;
        ocrCalls += 1;

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

        const quickAccept = confidence >= quickAcceptConfidence && quality.score >= adaptiveThresholds.qualityAcceptFloor - 3;
        const immediateAccept =
          confidence >= adaptiveThresholds.immediateAcceptConfidence - 2 &&
          quality.score >= adaptiveThresholds.qualityAcceptFloor;

        return quickAccept || immediateAccept;
      };

      const primaryRegion = quickRegions[0] ?? null;
      const secondaryRegion = quickRegions[1] ?? null;

      let acceptedInPrimary = false;
      if (primaryRegion) {
        acceptedInPrimary = await tryQuickRegion(primaryRegion, 0);
      }

      const bestConfidenceAfterPrimary = getCandidateConfidence(best);
      if (!acceptedInPrimary && secondaryRegion && bestConfidenceAfterPrimary < quickAcceptConfidence) {
        await tryQuickRegion(secondaryRegion, 1);
      }

      const bestConfidenceAfterQuick = getCandidateConfidence(best);
      if (!best || bestConfidenceAfterQuick < deepAcceptConfidence) {
        const bestRegionIndex = getCandidateRegionIndex(best);
        const fallbackRegion = quickRegions[bestRegionIndex] ?? quickRegions[0] ?? regions[0];

        if (fallbackRegion) {
          setZoneLabel(fallbackRegion.label);
          observedZone = fallbackRegion.label;
          drawRegionForOcr(frameCanvas, canvas, fallbackRegion, "deep");

          const deepStart = performance.now();
          const deepResult = await worker.recognize(canvas);
          const deepElapsed = Math.round(performance.now() - deepStart);
          totalOcrMs += deepElapsed;
          ocrCalls += 1;

          const deepText = deepResult.data?.text ?? "";
          const deepConfidence = Math.round(deepResult.data?.confidence ?? 0);
          const deepCandidate = extractSerialDigitsFromOcr(deepText, digitBounds);

          observedConfidence = Math.max(observedConfidence, deepConfidence);

          if (deepCandidate && deepConfidence >= MIN_CONFIDENCE) {
            const deepScore = deepConfidence * 0.64 + Math.max(observedQuality, qualityScore) * 0.24 + fallbackRegion.priority * 12;
            const deepPick: Candidate = {
              serial: deepCandidate,
              confidence: deepConfidence,
              quality: Math.max(observedQuality, qualityScore),
              score: deepScore,
              zoneLabel: fallbackRegion.label,
              regionIndex: 0
            };

            const bestScore = getCandidateScore(best);
            if (deepPick.score >= bestScore) {
              best = deepPick;
            }
          } else {
            bestHint = `No legible en ${fallbackRegion.label}.`;
          }
        }
      }

      if (best) {
        setLastConfidence(best.confidence);
        setQualityScore(best.quality);
        setZoneLabel(best.zoneLabel);
        setScanStatus("ready");
        setStatusText(`Tu numero de serie es "${best.serial}" - B`);

        recordScanSample(denomination, {
          ocrMs: ocrCalls > 0 ? Math.round(totalOcrMs / ocrCalls) : Math.min(deviceProfile.maxOcrMs, 420),
          quality: best.quality,
          confidence: best.confidence,
          success: true,
          zoneLabel: best.zoneLabel
        });

        if (typeof navigator.vibrate === "function") {
          navigator.vibrate(18);
        }

        onDetected(best.serial);
      } else {
        setLastConfidence(observedConfidence);
        setScanStatus("ready");
        setStatusText(bestHint);

        recordScanSample(denomination, {
          ocrMs: ocrCalls > 0 ? Math.round(totalOcrMs / ocrCalls) : Math.min(deviceProfile.maxOcrMs, 680),
          quality: observedQuality,
          confidence: observedConfidence,
          success: false,
          zoneLabel: observedZone
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
          <h2>Escaner rapido</h2>
          <p>Detecta automaticamente serie B para {denominationLabel}</p>
        </div>
        <div className="scanner-header-actions">
          <span className="scanner-tier-badge">
            {deviceProfile.tier.toUpperCase()} / {profileResolution.source.toUpperCase()}
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
