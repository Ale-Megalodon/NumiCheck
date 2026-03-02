import { useEffect, useMemo, useRef, useState } from "react";
import { getSharedOcrWorker, subscribeOcrWarmup } from "../services/ocrWorkerStore";
import { analyzeFrameQuality } from "../utils/frameQuality";
import {
  getAdaptiveThresholds,
  getDenominationTelemetry,
  getScanTelemetryStore,
  recordScanSample,
  resetScanTelemetryStore,
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
  onManualFallback: () => void;
};

const GUIDE_KEY = "numicheck_scan_guide_seen_v1";
const QUALITY_SAMPLE_WIDTH = 192;
const QUALITY_SAMPLE_HEIGHT = 56;
const MIN_CONFIDENCE = 34;

type Vote = {
  hits: number;
  score: number;
  bestConfidence: number;
  lastSeenAt: number;
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

function decayVotes(votes: Map<string, Vote>, now: number) {
  for (const [key, value] of votes.entries()) {
    if (now - value.lastSeenAt > 2600) {
      votes.delete(key);
      continue;
    }

    votes.set(key, {
      ...value,
      score: value.score * 0.9
    });
  }
}

export function SerialScannerPanel({
  denomination,
  denominationLabel,
  digitBounds,
  onDetected,
  onClose,
  onManualFallback
}: SerialScannerPanelProps) {
  const profileResolution = useMemo(() => resolveDeviceProfileForDenomination(denomination), [denomination]);
  const deviceProfile = profileResolution.profile;
  const adaptiveThresholds = useMemo(
    () => getAdaptiveThresholds(denomination, deviceProfile),
    [denomination, deviceProfile]
  );
  const telemetrySnapshot = useMemo(() => getDenominationTelemetry(denomination), [denomination]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const qualityCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const workerRef = useRef<OcrWorker | null>(null);
  const timerRef = useRef<number | null>(null);
  const readingLockRef = useRef(false);
  const resolvedRef = useRef(false);
  const guideOpenRef = useRef(false);
  const previousLumaRef = useRef<Uint8Array | null>(null);
  const votesRef = useRef<Map<string, Vote>>(new Map());
  const regionsRef = useRef<ReturnType<typeof buildScanRegions>>([]);
  const regionCursorRef = useRef(0);
  const panelStartAtRef = useRef(Date.now());
  const sessionOcrCountRef = useRef(0);
  const sessionOcrTotalRef = useRef(0);

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
  const [ocrAvgMs, setOcrAvgMs] = useState(Math.round(telemetrySnapshot.avgOcrMs || 0));
  const [telemetryPreview, setTelemetryPreview] = useState(() => getDenominationTelemetry(denomination));
  const [diagnosticNotice, setDiagnosticNotice] = useState("");

  const stopLoop = () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const scheduleNext = (delayMs: number, task: () => void) => {
    stopLoop();
    timerRef.current = window.setTimeout(task, delayMs);
  };

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
    guideOpenRef.current = showGuide;
  }, [showGuide]);

  useEffect(() => {
    const nextTelemetry = getDenominationTelemetry(denomination);
    setTelemetryPreview(nextTelemetry);
    setOcrAvgMs(Math.round(nextTelemetry.avgOcrMs || 0));
  }, [denomination]);

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

    const runScanCycle = async () => {
      if (cancelled || resolvedRef.current || readingLockRef.current) {
        return;
      }

      if (guideOpenRef.current) {
        scheduleNext(deviceProfile.badFrameDelayMs, () => {
          void runScanCycle();
        });
        return;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const qualityCanvas = qualityCanvasRef.current;
      const worker = workerRef.current;

      if (
        !video ||
        !canvas ||
        !qualityCanvas ||
        !worker ||
        video.readyState < 2 ||
        video.videoWidth === 0 ||
        video.videoHeight === 0
      ) {
        scheduleNext(deviceProfile.baseDelayMs, () => {
          void runScanCycle();
        });
        return;
      }

      if (regionsRef.current.length === 0) {
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
      }

      const regions = regionsRef.current;
      const currentRegion = regions[regionCursorRef.current % regions.length];
      regionCursorRef.current = (regionCursorRef.current + 1) % regions.length;
      setZoneLabel(currentRegion.label);

      const context = canvas.getContext("2d", { willReadFrequently: true });
      const qualityContext = qualityCanvas.getContext("2d", { willReadFrequently: true });

      if (!context || !qualityContext) {
        scheduleNext(deviceProfile.baseDelayMs, () => {
          void runScanCycle();
        });
        return;
      }

      qualityCanvas.width = QUALITY_SAMPLE_WIDTH;
      qualityCanvas.height = QUALITY_SAMPLE_HEIGHT;
      qualityContext.drawImage(
        video,
        currentRegion.left,
        currentRegion.top,
        currentRegion.width,
        currentRegion.height,
        0,
        0,
        QUALITY_SAMPLE_WIDTH,
        QUALITY_SAMPLE_HEIGHT
      );

      const qualityPixels = qualityContext.getImageData(0, 0, QUALITY_SAMPLE_WIDTH, QUALITY_SAMPLE_HEIGHT);
      const quality = analyzeFrameQuality(
        qualityPixels.data,
        QUALITY_SAMPLE_WIDTH,
        QUALITY_SAMPLE_HEIGHT,
        previousLumaRef.current
      );

      previousLumaRef.current = quality.lumaBuffer;
      setQualityScore(quality.score);
      setQualityLevel(quality.level);

      if (!quality.isGood) {
        setScanStatus("ready");
        setStatusText(`${currentRegion.label}: ${quality.hint}`);
        scheduleNext(deviceProfile.badFrameDelayMs, () => {
          void runScanCycle();
        });
        return;
      }

      readingLockRef.current = true;

      try {
        const targetSize = getOcrTargetSize(currentRegion.width, currentRegion.height);
        canvas.width = targetSize.width;
        canvas.height = targetSize.height;
        context.drawImage(
          video,
          currentRegion.left,
          currentRegion.top,
          currentRegion.width,
          currentRegion.height,
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

        setScanStatus("reading");
        setStatusText(`Leyendo en ${currentRegion.label}...`);

        const ocrStart = performance.now();
        const result = await worker.recognize(canvas);
        const ocrElapsed = Math.round(performance.now() - ocrStart);

        sessionOcrCountRef.current += 1;
        sessionOcrTotalRef.current += ocrElapsed;
        setOcrAvgMs(Math.round(sessionOcrTotalRef.current / sessionOcrCountRef.current));

        const text = result.data?.text ?? "";
        const confidence = Math.round(result.data?.confidence ?? 0);
        const candidate = extractSerialDigitsFromOcr(text, digitBounds);

        setLastConfidence(confidence);

        if (!candidate || confidence < MIN_CONFIDENCE) {
          setScanStatus("ready");
          setStatusText(`No legible aun (${ocrElapsed}ms). Ajusta el encuadre.`);
          recordScanSample(denomination, {
            ocrMs: ocrElapsed,
            quality: quality.score,
            confidence,
            success: false,
            zoneLabel: currentRegion.label
          });
          setTelemetryPreview(getDenominationTelemetry(denomination));

          const missDelay = Math.max(deviceProfile.ocrMissDelayMs, Math.round(ocrElapsed * 0.22));
          const slowPenalty = ocrElapsed > deviceProfile.maxOcrMs ? 90 : 0;
          scheduleNext(missDelay + slowPenalty, () => {
            void runScanCycle();
          });
          return;
        }

        setLastCandidate(candidate);

        const now = Date.now();
        decayVotes(votesRef.current, now);

        const previous = votesRef.current.get(candidate) ?? {
          hits: 0,
          score: 0,
          bestConfidence: 0,
          lastSeenAt: now
        };

        const candidateScoreDelta =
          confidence * 0.58 + quality.score * 0.3 + currentRegion.priority * 8 + (previous.hits > 0 ? 10 : 0);

        const next: Vote = {
          hits: previous.hits + 1,
          score: previous.score + candidateScoreDelta,
          bestConfidence: Math.max(previous.bestConfidence, confidence),
          lastSeenAt: now
        };

        votesRef.current.set(candidate, next);

        const immediateAccept =
          confidence >= adaptiveThresholds.immediateAcceptConfidence &&
          quality.score >= adaptiveThresholds.qualityAcceptFloor + 2;

        const fastAccept =
          next.bestConfidence >= adaptiveThresholds.fastAcceptConfidence &&
          quality.score >= adaptiveThresholds.qualityAcceptFloor &&
          next.hits >= adaptiveThresholds.requiredHits;

        const scoreAccept = next.score >= 175 && next.hits >= adaptiveThresholds.requiredHits;
        const consensusAccept = next.hits >= Math.max(3, adaptiveThresholds.requiredHits + 1);

        if (immediateAccept || fastAccept || scoreAccept || consensusAccept) {
          resolvedRef.current = true;
          stopLoop();
          const elapsedTotalMs = Date.now() - panelStartAtRef.current;
          setScanStatus("ready");
          setStatusText(`Numero detectado en ${(elapsedTotalMs / 1000).toFixed(1)}s. Verificando...`);

          recordScanSample(denomination, {
            ocrMs: ocrElapsed,
            quality: quality.score,
            confidence,
            success: true,
            zoneLabel: currentRegion.label
          });
          setTelemetryPreview(getDenominationTelemetry(denomination));

          if (typeof navigator.vibrate === "function") {
            navigator.vibrate(22);
          }

          onDetected(candidate);
          return;
        }

        setScanStatus("ready");
        setStatusText(`Detectado ${candidate}, confirmando...`);
        recordScanSample(denomination, {
          ocrMs: ocrElapsed,
          quality: quality.score,
          confidence,
          success: false,
          zoneLabel: currentRegion.label
        });
        setTelemetryPreview(getDenominationTelemetry(denomination));

        const hitDelay = Math.max(deviceProfile.readHitDelayMs, Math.round(ocrElapsed * 0.16));
        scheduleNext(hitDelay, () => {
          void runScanCycle();
        });
      } catch {
        setScanStatus("ready");
        setStatusText("Reintentando lectura...");
        scheduleNext(deviceProfile.baseDelayMs, () => {
          void runScanCycle();
        });
      } finally {
        readingLockRef.current = false;
      }
    };

    const boot = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Tu navegador no soporta camara en vivo.");
        }

        setScanStatus("starting");
        setStatusText("Solicitando permiso de camara...");

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

        panelStartAtRef.current = Date.now();
        setScanStatus("ready");
        setStatusText(`Enfoca el serial de ${denominationLabel} dentro del recuadro`);

        scheduleNext(Math.max(60, Math.round(deviceProfile.baseDelayMs * 0.35)), () => {
          void runScanCycle();
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "No se pudo iniciar el escaner.";
        setScanStatus("error");
        setErrorText(message);
      }
    };

    void boot();

    return () => {
      cancelled = true;
      stopLoop();
      stopMedia();
    };
  }, [denomination, denominationLabel, digitBounds, onDetected, deviceProfile, adaptiveThresholds]);

  const handleCloseGuide = () => {
    setShowGuide(false);
    window.localStorage.setItem(GUIDE_KEY, "1");
  };

  const handleCopyDiagnostics = async () => {
    const payload = {
      generatedAt: new Date().toISOString(),
      denomination,
      denominationLabel,
      device: {
        modelHint: profileResolution.modelHint,
        cores: profileResolution.cores,
        memory: profileResolution.memory,
        userAgent: profileResolution.userAgent
      },
      profile: {
        source: profileResolution.source,
        matchedOverride: profileResolution.matchedOverride
          ? {
              id: profileResolution.matchedOverride.id,
              label: profileResolution.matchedOverride.label,
              tierOverride: profileResolution.matchedOverride.tierOverride,
              denomination: profileResolution.matchedOverride.denomination,
              patch: profileResolution.matchedOverride.patch
            }
          : null,
        active: deviceProfile,
        adaptiveThresholds
      },
      session: {
        status: scanStatus,
        statusText,
        zoneLabel,
        qualityScore,
        qualityLevel,
        lastCandidate,
        lastConfidence,
        ocrAvgMs,
        torchSupported,
        torchEnabled
      },
      telemetry: getScanTelemetryStore()
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setDiagnosticNotice("Diagnostico copiado");
      window.setTimeout(() => setDiagnosticNotice(""), 1800);
    } catch {
      setDiagnosticNotice("No se pudo copiar");
      window.setTimeout(() => setDiagnosticNotice(""), 1800);
    }
  };

  const handleResetTelemetry = () => {
    const confirmed = window.confirm("Reiniciar telemetria local de escaneo para nueva calibracion?");
    if (!confirmed) {
      return;
    }

    resetScanTelemetryStore();
    const fresh = getDenominationTelemetry(denomination);
    setTelemetryPreview(fresh);
    setOcrAvgMs(Math.round(fresh.avgOcrMs || 0));
    setDiagnosticNotice("Telemetria reiniciada");
    window.setTimeout(() => setDiagnosticNotice(""), 1800);
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

      <p className="scanner-zone-label">{zoneLabel}</p>
      <p className="scanner-status">{statusText}</p>

      {scanStatus === "starting" ? <p className="scanner-progress">Cargando OCR... {ocrProgress}%</p> : null}
      {lastCandidate ? <p className="scanner-progress">Lectura detectada: {lastCandidate}</p> : null}
      {lastConfidence > 0 ? <p className="scanner-progress">Confianza OCR: {lastConfidence}%</p> : null}
      <p className="scanner-progress">OCR promedio: {ocrAvgMs > 0 ? `${ocrAvgMs}ms` : "-"}</p>
      <p className="scanner-progress">
        Historial exitoso: {telemetryPreview.successes} lecturas ({telemetryPreview.attempts} intentos)
      </p>
      {profileResolution.matchedOverride ? (
        <p className="scanner-progress">Perfil aplicado: {profileResolution.matchedOverride.label}</p>
      ) : null}
      {diagnosticNotice ? <p className="scanner-progress scanner-progress--notice">{diagnosticNotice}</p> : null}
      {errorText ? <p className="manual-error">{errorText}</p> : null}

      <div className="scanner-actions-row">
        {torchSupported ? (
          <button
            type="button"
            className={`scanner-secondary ${torchEnabled ? "scanner-secondary--active" : ""}`}
            onClick={() => void toggleTorch()}
          >
            {torchEnabled ? "Luz encendida" : "Encender luz"}
          </button>
        ) : null}
        <button type="button" className="scanner-secondary" onClick={() => void handleCopyDiagnostics()}>
          Copiar diagnostico
        </button>
        <button type="button" className="scanner-secondary" onClick={handleResetTelemetry}>
          Reiniciar telemetria
        </button>
        <button type="button" className="scanner-secondary" onClick={onManualFallback}>
          Ingresar manualmente
        </button>
        <button type="button" className="manual-submit" onClick={onClose}>
          Cerrar escaner
        </button>
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
