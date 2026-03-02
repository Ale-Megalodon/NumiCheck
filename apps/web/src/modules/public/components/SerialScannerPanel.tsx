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

const GUIDE_KEY = "numicheck_scan_guide_seen_v1";
const QUALITY_SAMPLE_WIDTH = 192;
const QUALITY_SAMPLE_HEIGHT = 56;
const MIN_CONFIDENCE = 34;
const SNAP_FLASH_MS = 120;

type Candidate = {
  serial: string;
  confidence: number;
  quality: number;
  score: number;
  zoneLabel: string;
};

function getOcrTargetSize(regionWidth: number, regionHeight: number) {
  const targetWidth = Math.max(320, Math.min(640, Math.round(regionWidth * 0.6)));
  const ratio = targetWidth / Math.max(1, regionWidth);
  const targetHeight = Math.max(72, Math.min(220, Math.round(regionHeight * ratio)));

  return {
    width: targetWidth,
    height: targetHeight
  };
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
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const workerRef = useRef<OcrWorker | null>(null);
  const regionsRef = useRef<ReturnType<typeof buildScanRegions>>([]);

  const [scanStatus, setScanStatus] = useState<ScanStatus>("starting");
  const [statusText, setStatusText] = useState("Preparando camara...");
  const [errorText, setErrorText] = useState("");
  const [lastCandidate, setLastCandidate] = useState("");
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
        setLastCandidate("");
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
    const worker = workerRef.current;

    if (!video || !canvas || !qualityCanvas || !worker || video.videoWidth === 0 || video.videoHeight === 0) {
      setStatusText("Camara aun no lista. Espera un momento.");
      return;
    }

    const context = canvas.getContext("2d", { willReadFrequently: true });
    const qualityContext = qualityCanvas.getContext("2d", { willReadFrequently: true });

    if (!context || !qualityContext) {
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

    try {
      const regions = regionsRef.current.length > 0 ? regionsRef.current : buildScanRegions(denomination, video.videoWidth, video.videoHeight);

      for (const region of regions) {
        setZoneLabel(region.label);
        observedZone = region.label;

        qualityCanvas.width = QUALITY_SAMPLE_WIDTH;
        qualityCanvas.height = QUALITY_SAMPLE_HEIGHT;
        qualityContext.drawImage(
          video,
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
          continue;
        }

        const targetSize = getOcrTargetSize(region.width, region.height);
        canvas.width = targetSize.width;
        canvas.height = targetSize.height;
        context.drawImage(
          video,
          region.left,
          region.top,
          region.width,
          region.height,
          0,
          0,
          targetSize.width,
          targetSize.height
        );

        const image = context.getImageData(0, 0, targetSize.width, targetSize.height);
        const data = image.data;
        for (let i = 0; i < data.length; i += 4) {
          const gray = data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
          const boosted = gray > 154 ? 255 : gray < 96 ? 0 : gray;
          data[i] = boosted;
          data[i + 1] = boosted;
          data[i + 2] = boosted;
        }
        context.putImageData(image, 0, 0);

        const ocrStart = performance.now();
        const result = await worker.recognize(canvas);
        const ocrElapsed = Math.round(performance.now() - ocrStart);

        const text = result.data?.text ?? "";
        const confidence = Math.round(result.data?.confidence ?? 0);
        observedConfidence = Math.max(observedConfidence, confidence);

        const candidate = extractSerialDigitsFromOcr(text, digitBounds);

        if (!candidate || confidence < MIN_CONFIDENCE) {
          recordScanSample(denomination, {
            ocrMs: ocrElapsed,
            quality: quality.score,
            confidence,
            success: false,
            zoneLabel: region.label
          });
          bestHint = `No legible en ${region.label}.`;
          continue;
        }

        const candidateScore = confidence * 0.58 + quality.score * 0.3 + region.priority * 8;
        const current: Candidate = {
          serial: candidate,
          confidence,
          quality: quality.score,
          score: candidateScore,
          zoneLabel: region.label
        };

        if (!best || current.score > best.score) {
          best = current;
        }

        const immediateAccept =
          confidence >= adaptiveThresholds.immediateAcceptConfidence &&
          quality.score >= adaptiveThresholds.qualityAcceptFloor + 2;

        const fastAccept =
          confidence >= adaptiveThresholds.fastAcceptConfidence && quality.score >= adaptiveThresholds.qualityAcceptFloor;

        if (immediateAccept || fastAccept) {
          break;
        }
      }

      if (best) {
        setLastCandidate(best.serial);
        setLastConfidence(best.confidence);
        setQualityScore(best.quality);
        setZoneLabel(best.zoneLabel);
        setScanStatus("ready");
        setStatusText(`Tu numero de serie es "${best.serial}" - B`);

        recordScanSample(denomination, {
          ocrMs: Math.min(deviceProfile.maxOcrMs, 500),
          quality: best.quality,
          confidence: best.confidence,
          success: true,
          zoneLabel: best.zoneLabel
        });

        if (typeof navigator.vibrate === "function") {
          navigator.vibrate(22);
        }

        onDetected(best.serial);
      } else {
        setLastCandidate("");
        setLastConfidence(observedConfidence);
        setScanStatus("ready");
        setStatusText(bestHint);

        recordScanSample(denomination, {
          ocrMs: Math.min(deviceProfile.maxOcrMs, 720),
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
