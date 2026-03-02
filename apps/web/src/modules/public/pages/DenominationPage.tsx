import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useAuth } from "../../../app/providers/AuthProvider";
import { registerAdminUserQuery } from "../../admin/services/adminUsersStore";
import {
  type Denomination,
  getSerialDigitBounds,
  evaluateSeriesAgainstIllegalRanges
} from "../../admin/services/illegalRangesStore";
import { HamburgerMenu } from "../components/HamburgerMenu";
import { PublicBrand } from "../components/PublicBrand";
import { BackHomeButton } from "../components/BackHomeButton";
import { SerialScannerPanel } from "../components/SerialScannerPanel";
import { BANKNOTE_OPTIONS } from "../constants/banknotes";
import { getSharedOcrWorker, warmupSharedOcrWorker } from "../services/ocrWorkerStore";
import {
  appendVerificationHistory,
  type VerificationSource
} from "../services/publicVerificationHistoryStore";
import { analyzeFrameQuality } from "../utils/frameQuality";
import { buildScanRegions, type ScannerDenomination } from "../utils/scanRegionProfiles";
import { extractSerialDigitsFromOcr } from "../utils/serialOcr";

type ModalOutcome = {
  status: "illegal" | "legal";
  serial: string;
};

type ScanPreview = {
  serial: string;
  confidence: number;
  quality: number;
  source: VerificationSource;
};

type OcrWorker = {
  recognize: (image: HTMLCanvasElement) => Promise<{ data?: { text?: string; confidence?: number } }>;
};

const MAX_UPLOAD_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_UPLOAD_SIDE = 1280;
const MIN_UPLOAD_PREVIEW_CONFIDENCE = 60;
const UPLOAD_QUALITY_SAMPLE_WIDTH = 180;
const UPLOAD_QUALITY_SAMPLE_HEIGHT = 56;

function CameraMiniIcon() {
  return (
    <svg
      className="denomination-action-icon"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M7.5 7.5H5.75A2.25 2.25 0 0 0 3.5 9.75v7.5A2.25 2.25 0 0 0 5.75 19.5h12.5a2.25 2.25 0 0 0 2.25-2.25v-7.5a2.25 2.25 0 0 0-2.25-2.25H16.5l-1.1-1.65a1.5 1.5 0 0 0-1.25-.67h-4.3a1.5 1.5 0 0 0-1.25.67L7.5 7.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="13.2" r="3.1" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function DenominationPage() {
  const { denomination } = useParams<{ denomination: string }>();
  const { loading, user } = useAuth();
  const selected = BANKNOTE_OPTIONS.find((item) => item.denomination === denomination);
  const [showManualForm, setShowManualForm] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [scanPreview, setScanPreview] = useState<ScanPreview | null>(null);
  const [isUploadingScan, setIsUploadingScan] = useState(false);
  const [serialDigits, setSerialDigits] = useState("");
  const [seriesLetter, setSeriesLetter] = useState("B");
  const [formError, setFormError] = useState("");
  const [modalOutcome, setModalOutcome] = useState<ModalOutcome | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const normalizedSeries = useMemo(() => seriesLetter.toUpperCase().slice(0, 1), [seriesLetter]);
  const seriesWarning =
    normalizedSeries !== "B"
      ? "Solo se admite la serie B para esta verificacion oficial de billetes inhabilitados."
      : "";

  if (!selected) {
    return <Navigate to="/" replace />;
  }

  const denominationValue = selected.denomination as Denomination;
  const digitBounds = getSerialDigitBounds(denominationValue);
  const denominationTitle = `Escanea tus ${selected.denomination} Bs!`;
  const pageThemeClass = `public-page public-page--denomination public-page--${selected.denomination}`;

  useEffect(() => {
    if (loading) {
      return;
    }

    const timer = window.setTimeout(() => {
      void warmupSharedOcrWorker();
    }, 280);

    return () => window.clearTimeout(timer);
  }, [loading]);

  const resolveSerial = (
    digits: string,
    metadata: { source: VerificationSource; confidence?: number | null; quality?: number | null }
  ) => {
    const serialWithSeries = `${digits}B`;
    const evaluation = evaluateSeriesAgainstIllegalRanges(denominationValue, serialWithSeries);

    if (evaluation.status === "invalid") {
      setFormError(evaluation.reason);
      return;
    }

    const finalStatus = evaluation.status === "illegal" ? "illegal" : "legal";
    setModalOutcome({
      status: finalStatus,
      serial: digits
    });

    if (user) {
      registerAdminUserQuery(user.uid, finalStatus);
    }

    appendVerificationHistory(user?.uid, {
      denomination: denominationValue,
      serial: digits,
      status: finalStatus,
      source: metadata.source,
      confidence: metadata.confidence ?? null,
      quality: metadata.quality ?? null
    });
  };

  const handleScanClick = () => {
    setFormError("");
    setShowManualForm(false);
    setScanPreview(null);
    setShowScanner(true);
  };

  const handleUploadScanClick = () => {
    if (isUploadingScan) {
      return;
    }

    uploadInputRef.current?.click();
  };

  const handleUploadScanFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setFormError("Sube un archivo de imagen valido para escanear.");
      return;
    }

    if (file.size > MAX_UPLOAD_IMAGE_BYTES) {
      setFormError("La imagen pesa demasiado. Usa una de maximo 6 MB.");
      return;
    }

    setIsUploadingScan(true);
    setFormError("");
    setShowManualForm(false);
    setShowScanner(false);
    setScanPreview(null);

    const imageUrl = window.URL.createObjectURL(file);
    const image = new Image();

    const loadResult = await new Promise<{ ok: true } | { ok: false }>((resolve) => {
      image.onload = () => resolve({ ok: true });
      image.onerror = () => resolve({ ok: false });
      image.src = imageUrl;
    });

    if (!loadResult.ok || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
      window.URL.revokeObjectURL(imageUrl);
      setIsUploadingScan(false);
      setFormError("No pudimos abrir la imagen. Intenta con otra.");
      return;
    }

    try {
      const worker = (await getSharedOcrWorker()) as OcrWorker;
      const frameCanvas = document.createElement("canvas");
      const frameContext = frameCanvas.getContext("2d", { willReadFrequently: true });
      const ocrCanvas = document.createElement("canvas");
      const ocrContext = ocrCanvas.getContext("2d", { willReadFrequently: true });

      if (!frameContext || !ocrContext) {
        throw new Error("No se pudo preparar el analisis de imagen.");
      }

      const scale = Math.min(1, MAX_UPLOAD_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
      const targetWidth = Math.max(220, Math.round(image.naturalWidth * scale));
      const targetHeight = Math.max(140, Math.round(image.naturalHeight * scale));
      frameCanvas.width = targetWidth;
      frameCanvas.height = targetHeight;
      frameContext.drawImage(image, 0, 0, targetWidth, targetHeight);

      const regions = buildScanRegions(denominationValue as ScannerDenomination, targetWidth, targetHeight).sort(
        (a, b) => b.priority - a.priority
      );

      let bestCandidate: string | null = null;
      let bestConfidence = 0;
      let bestQuality = 0;
      let bestScore = 0;

      const scanRegion = async (left: number, top: number, width: number, height: number) => {
        const qualityCanvas = document.createElement("canvas");
        const qualityContext = qualityCanvas.getContext("2d", { willReadFrequently: true });
        if (!qualityContext) {
          return;
        }

        qualityCanvas.width = UPLOAD_QUALITY_SAMPLE_WIDTH;
        qualityCanvas.height = UPLOAD_QUALITY_SAMPLE_HEIGHT;
        qualityContext.drawImage(
          frameCanvas,
          left,
          top,
          width,
          height,
          0,
          0,
          UPLOAD_QUALITY_SAMPLE_WIDTH,
          UPLOAD_QUALITY_SAMPLE_HEIGHT
        );
        const qualityPixels = qualityContext.getImageData(0, 0, UPLOAD_QUALITY_SAMPLE_WIDTH, UPLOAD_QUALITY_SAMPLE_HEIGHT);
        const qualityAnalysis = analyzeFrameQuality(
          qualityPixels.data,
          UPLOAD_QUALITY_SAMPLE_WIDTH,
          UPLOAD_QUALITY_SAMPLE_HEIGHT,
          null
        );

        const targetOcrWidth = Math.max(190, Math.min(360, Math.round(width * 0.36)));
        const ratio = targetOcrWidth / Math.max(1, width);
        const targetOcrHeight = Math.max(52, Math.min(120, Math.round(height * ratio)));
        ocrCanvas.width = targetOcrWidth;
        ocrCanvas.height = targetOcrHeight;
        ocrContext.imageSmoothingEnabled = false;
        ocrContext.filter = "grayscale(1) contrast(1.7) brightness(1.06)";
        ocrContext.drawImage(frameCanvas, left, top, width, height, 0, 0, targetOcrWidth, targetOcrHeight);
        ocrContext.filter = "none";

        const result = await worker.recognize(ocrCanvas);
        const confidence = Math.round(result.data?.confidence ?? 0);
        const text = result.data?.text ?? "";
        const candidate = extractSerialDigitsFromOcr(text, digitBounds);
        if (!candidate) {
          return;
        }

        const qualityScore = qualityAnalysis.score;
        const combinedScore = confidence * 0.58 + qualityScore * 0.42;

        if (combinedScore >= bestScore) {
          bestCandidate = candidate;
          bestConfidence = confidence;
          bestQuality = qualityScore;
          bestScore = combinedScore;
        }
      };

      for (const region of regions.slice(0, 3)) {
        await scanRegion(region.left, region.top, region.width, region.height);
        if (bestConfidence >= 66) {
          break;
        }
      }

      if (!bestCandidate) {
        await scanRegion(0, 0, targetWidth, targetHeight);
      }

      const estimatedEffectiveness = Math.round(bestConfidence * 0.55 + bestQuality * 0.45);

      if (!bestCandidate || estimatedEffectiveness < MIN_UPLOAD_PREVIEW_CONFIDENCE) {
        setFormError("Imagen borrosa. Intenta escanearlo de forma manual.");
        return;
      }

      setScanPreview({
        serial: bestCandidate,
        confidence: bestConfidence,
        quality: bestQuality,
        source: "scan_upload"
      });
    } catch {
      setFormError("Imagen borrosa. Intenta escanearlo de forma manual.");
    } finally {
      window.URL.revokeObjectURL(imageUrl);
      setIsUploadingScan(false);
    }
  };

  const handleRescanFromPreview = () => {
    setScanPreview(null);
    setShowScanner(true);
  };

  const handleVerifyScannedNow = () => {
    if (!scanPreview) {
      return;
    }

    setScanPreview(null);
    resolveSerial(scanPreview.serial, {
      source: scanPreview.source,
      confidence: scanPreview.confidence,
      quality: scanPreview.quality
    });
  };

  const scanEstimatedSuccess = useMemo(() => {
    if (!scanPreview) {
      return 0;
    }

    const weighted = Math.round(scanPreview.confidence * 0.78 + scanPreview.quality * 0.22);
    return Math.max(60, Math.min(99, weighted));
  }, [scanPreview]);

  const handleManualSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");

    if (serialDigits.length < digitBounds.minDigits || serialDigits.length > digitBounds.maxDigits) {
      setFormError(
        `El numero de serie para ${selected.label} debe tener entre ${digitBounds.minDigits} y ${digitBounds.maxDigits} digitos.`
      );
      return;
    }

    if (normalizedSeries !== "B") {
      setFormError("Solo se permite la serie B en esta etapa del sistema.");
      return;
    }

    resolveSerial(serialDigits, {
      source: "manual",
      confidence: null,
      quality: null
    });
  };

  return (
    <main className={pageThemeClass}>
      <section className="public-shell">
        <header className="public-header">
          <HamburgerMenu />
          <PublicBrand loading={loading} user={user} />
        </header>
        <BackHomeButton loading={loading} />

        <section className="denomination-screen">
          {loading ? (
            <>
              <div className="denomination-kicker-skeleton skeleton" aria-hidden="true" />
              <div className="denomination-action-skeleton skeleton" aria-hidden="true" />
              <div className="denomination-action-skeleton skeleton" aria-hidden="true" />
              <div className="denomination-action-skeleton skeleton" aria-hidden="true" />
              <div className="manual-card-skeleton skeleton" aria-hidden="true" />
            </>
          ) : (
            <>
              <h1 className="denomination-kicker">{denominationTitle}</h1>

              <section className="denomination-actions">
                <button type="button" className="denomination-action" onClick={handleScanClick}>
                  <span>Escanea el numero de serie</span>
                  <CameraMiniIcon />
                </button>
                <button type="button" className="denomination-action" onClick={handleUploadScanClick} disabled={isUploadingScan}>
                  {isUploadingScan ? "Escaneando imagen..." : "Subir imagen y escanear"}
                </button>
                <button
                  type="button"
                  className="denomination-action"
                  onClick={() => setShowManualForm((prev) => !prev)}
                >
                  Ingrese el numero de serie de forma manual
                </button>
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept="image/*"
                  className="scanner-canvas-hidden"
                  onChange={handleUploadScanFileChange}
                />
              </section>

              {showScanner ? (
                <SerialScannerPanel
                  denomination={denominationValue}
                  denominationLabel={selected.label}
                  digitBounds={digitBounds}
                  onDetected={(result) => {
                    setShowScanner(false);
                    setScanPreview({
                      serial: result.serialDigits,
                      confidence: result.confidence,
                      quality: result.quality,
                      source: "scan_camera"
                    });
                  }}
                  onClose={() => setShowScanner(false)}
                />
              ) : null}

              {showManualForm ? (
                <form className="manual-card" onSubmit={handleManualSubmit}>
                  <h2 className="manual-title">Numero de serie</h2>
                  <div className="manual-grid">
                    <label className="manual-field">
                      <span>Numero de serie</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        className="manual-input"
                        maxLength={digitBounds.maxDigits}
                        value={serialDigits}
                        onChange={(event) => {
                          const digitsOnly = event.target.value.replace(/\D/g, "").slice(0, digitBounds.maxDigits);
                          setSerialDigits(digitsOnly);
                        }}
                        placeholder={`Ej: ${"0".repeat(digitBounds.maxDigits)}`}
                        aria-label="Numero de serie"
                      />
                    </label>

                    <label className="manual-field manual-field--series">
                      <span>Serie</span>
                      <input
                        type="text"
                        className="manual-input"
                        maxLength={1}
                        value={seriesLetter}
                        onChange={(event) => setSeriesLetter(event.target.value.toUpperCase().slice(0, 1))}
                        aria-label="Serie"
                      />
                    </label>
                  </div>

                  {seriesWarning ? <p className="manual-warning">{seriesWarning}</p> : null}
                  {formError ? <p className="manual-error">{formError}</p> : null}

                  <button type="submit" className="manual-submit">
                    Enviar
                  </button>
                </form>
              ) : null}
            </>
          )}
        </section>
      </section>

      {modalOutcome ? (
        <div className="serial-result-overlay" role="dialog" aria-modal="true">
          <article className={`serial-result-card serial-result-card--${modalOutcome.status}`}>
            <button type="button" className="serial-result-close" onClick={() => setModalOutcome(null)}>
              X
            </button>
            {modalOutcome.status === "illegal" ? (
              <>
                <h3 className="serial-result-title">Numero de Serie sospechoso detectado!</h3>
                <p className="serial-result-text">
                  El numero de serie "{modalOutcome.serial}" - Serie B se encuentra dentro del rango de billetes
                  declarados inhabilitados para transacciones, segun el listado oficial emitido por el Banco Central
                  de Bolivia. Se recomienda verificar la informacion y tomar las medidas correspondientes conforme a la
                  normativa vigente.
                </p>
              </>
            ) : (
              <>
                <h3 className="serial-result-title">Billete no observado</h3>
                <p className="serial-result-text">
                  El numero de serie "{modalOutcome.serial}" - Serie B no figura en el listado oficial de billetes
                  inhabilitados del Banco Central de Bolivia.
                </p>
              </>
            )}
          </article>
        </div>
      ) : null}

      {scanPreview ? (
        <div className="serial-result-overlay" role="dialog" aria-modal="true">
          <article className="serial-result-card serial-result-card--scan">
            <button type="button" className="serial-result-close" onClick={() => setScanPreview(null)}>
              X
            </button>
            <h3 className="serial-result-title">Lectura super turbo completada</h3>
            <p className="serial-result-text">{`Tu serie "${scanPreview.serial}" - B tiene un ${scanEstimatedSuccess}% de efectividad.`}</p>
            <div className="serial-result-actions">
              <button type="button" className="serial-result-action serial-result-action--ghost" onClick={handleRescanFromPreview}>
                Escanear de nuevo?
              </button>
              <button type="button" className="serial-result-action serial-result-action--verify" onClick={handleVerifyScannedNow}>
                Verificar numero de serie
              </button>
            </div>
          </article>
        </div>
      ) : null}
    </main>
  );
}
