import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useAuth } from "../../../app/providers/AuthProvider";
import { BrandWordmark } from "../../../shared/components/ui/BrandWordmark";
import { registerAdminUserQuery } from "../../admin/services/adminUsersStore";
import {
  type Denomination,
  getSerialDigitBounds,
  evaluateSeriesAgainstIllegalRanges
} from "../../admin/services/illegalRangesStore";
import { HamburgerMenu } from "../components/HamburgerMenu";
import { SerialScannerPanel } from "../components/SerialScannerPanel";
import { BANKNOTE_OPTIONS } from "../constants/banknotes";
import { warmupSharedOcrWorker } from "../services/ocrWorkerStore";

type ModalOutcome = {
  status: "illegal" | "legal";
  serial: string;
};

type ScanPreview = {
  serial: string;
  confidence: number;
  quality: number;
};

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
  const [serialDigits, setSerialDigits] = useState("");
  const [seriesLetter, setSeriesLetter] = useState("B");
  const [formError, setFormError] = useState("");
  const [modalOutcome, setModalOutcome] = useState<ModalOutcome | null>(null);

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

  useEffect(() => {
    if (loading) {
      return;
    }

    const timer = window.setTimeout(() => {
      void warmupSharedOcrWorker();
    }, 280);

    return () => window.clearTimeout(timer);
  }, [loading]);

  const resolveSerial = (digits: string) => {
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
  };

  const handleScanClick = () => {
    setFormError("");
    setShowManualForm(false);
    setScanPreview(null);
    setShowScanner(true);
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
    resolveSerial(scanPreview.serial);
  };

  const scanEstimatedSuccess = useMemo(() => {
    if (!scanPreview) {
      return 0;
    }

    const weighted = Math.round(scanPreview.confidence * 0.78 + scanPreview.quality * 0.22);
    return Math.max(55, Math.min(99, weighted));
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

    resolveSerial(serialDigits);
  };

  return (
    <main className="public-page">
      <section className="public-shell">
        <header className="public-header">
          <HamburgerMenu />
          {loading ? (
            <div className="public-brand-skeleton">
              <div className="public-brand-logo-skeleton skeleton" aria-hidden="true" />
              <div className="public-brand-wordmark-skeleton skeleton" aria-hidden="true" />
            </div>
          ) : (
            <div className="public-brand">
              <img className="public-brand-logo" src="/img/logoNumiCheck.jpeg" alt="Logo NumiCheck" />
              <BrandWordmark className="public-brand-wordmark" weight="semibold" />
            </div>
          )}
        </header>

        <section className="denomination-screen">
          {loading ? (
            <>
              <div className="denomination-kicker-skeleton skeleton" aria-hidden="true" />
              <div className="denomination-action-skeleton skeleton" aria-hidden="true" />
              <div className="denomination-action-skeleton skeleton" aria-hidden="true" />
              <div className="manual-card-skeleton skeleton" aria-hidden="true" />
            </>
          ) : (
            <>
              <p className="denomination-kicker">{`${selected.denomination} bs >`}</p>

              <section className="denomination-actions">
                <button type="button" className="denomination-action" onClick={handleScanClick}>
                  <span>Escanea el numero de serie</span>
                  <CameraMiniIcon />
                </button>
                <button
                  type="button"
                  className="denomination-action"
                  onClick={() => setShowManualForm((prev) => !prev)}
                >
                  Ingrese el numero de serie de forma manual
                </button>
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
                      quality: result.quality
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
            <h3 className="serial-result-title">Lectura completada</h3>
            <p className="serial-result-text">{`Tu numero de serie es "${scanPreview.serial}" - B`}</p>
            <p className="serial-result-text serial-result-text--subtle">{`Probabilidad estimada de acierto: ${scanEstimatedSuccess}%`}</p>
            <div className="serial-result-actions">
              <button type="button" className="serial-result-action serial-result-action--ghost" onClick={handleRescanFromPreview}>
                Escanear de nuevo
              </button>
              <button type="button" className="serial-result-action serial-result-action--verify" onClick={handleVerifyScannedNow}>
                Verificar ya!
              </button>
            </div>
          </article>
        </div>
      ) : null}
    </main>
  );
}
