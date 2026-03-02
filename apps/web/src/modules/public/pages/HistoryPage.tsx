import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../app/providers/AuthProvider";
import { HamburgerMenu } from "../components/HamburgerMenu";
import { BackHomeButton } from "../components/BackHomeButton";
import { PublicBrand } from "../components/PublicBrand";
import {
  clearVerificationHistory,
  getVerificationHistory,
  type VerificationHistoryEntry
} from "../services/publicVerificationHistoryStore";

function formatDate(dateIso: string) {
  try {
    return new Date(dateIso).toLocaleString("es-BO");
  } catch {
    return dateIso;
  }
}

function mapSourceLabel(source: VerificationHistoryEntry["source"]) {
  if (source === "manual") {
    return "Manual";
  }

  if (source === "scan_upload") {
    return "Imagen";
  }

  return "Camara";
}

export function HistoryPage() {
  const navigate = useNavigate();
  const { loading, user } = useAuth();
  const [historyRows, setHistoryRows] = useState<VerificationHistoryEntry[]>([]);
  const [hydrating, setHydrating] = useState(true);

  useEffect(() => {
    if (loading) {
      return;
    }

    setHistoryRows(getVerificationHistory(user?.uid));
    setHydrating(true);
    const timer = window.setTimeout(() => setHydrating(false), 380);
    return () => window.clearTimeout(timer);
  }, [loading, user?.uid]);

  const hasRows = historyRows.length > 0;
  const loadingState = loading || hydrating;
  const legalCount = useMemo(() => historyRows.filter((row) => row.status === "legal").length, [historyRows]);
  const illegalCount = useMemo(() => historyRows.filter((row) => row.status === "illegal").length, [historyRows]);

  const handleClearHistory = () => {
    if (!user) {
      return;
    }

    const confirmed = window.confirm("Vaciar todo tu historial de verificaciones?");
    if (!confirmed) {
      return;
    }

    clearVerificationHistory(user.uid);
    setHistoryRows([]);
  };

  if (!loading && !user) {
    return (
      <main className="public-page">
        <section className="public-shell">
          <header className="public-header">
            <HamburgerMenu />
            <PublicBrand loading={loading} user={user} />
          </header>

          <section className="history-shell">
            <article className="history-card">
              <h1 className="history-title">Historial de verificaciones</h1>
              <p className="history-note">Inicia sesion para guardar y ver tu historial completo.</p>
              <button type="button" className="auth-button" onClick={() => navigate("/login")}>
                Iniciar sesion
              </button>
            </article>
          </section>
        </section>
      </main>
    );
  }

  return (
    <main className="public-page">
      <section className="public-shell">
        <header className="public-header">
          <HamburgerMenu />
          <PublicBrand loading={loading} user={user} />
        </header>
        <BackHomeButton loading={loading} />

        <section className="history-shell">
          {loadingState ? (
            <article className="history-card history-card--skeleton" aria-hidden="true">
              <div className="history-title-skeleton skeleton" />
              <div className="history-summary-skeleton skeleton" />
              <div className="history-row-skeleton skeleton" />
              <div className="history-row-skeleton skeleton" />
              <div className="history-row-skeleton skeleton" />
            </article>
          ) : (
            <article className="history-card">
              <header className="history-head">
                <div>
                  <h1 className="history-title">Historial de verificaciones</h1>
                  <p className="history-note">Todas tus verificaciones guardadas con fecha y metodo.</p>
                </div>
                <button type="button" className="menu-toggle" onClick={handleClearHistory} disabled={!hasRows}>
                  Vaciar historial
                </button>
              </header>

              <div className="history-summary">
                <span>Total: {historyRows.length}</span>
                <span>Legales: {legalCount}</span>
                <span>Ilegales: {illegalCount}</span>
              </div>

              {!hasRows ? (
                <p className="history-empty">Aun no tienes verificaciones guardadas.</p>
              ) : (
                <div className="history-list">
                  {historyRows.map((row) => (
                    <article key={row.id} className="history-item">
                      <div className="history-item-main">
                        <p className="history-serial">{`Bs ${row.denomination} | ${row.serial} - B`}</p>
                        <p className="history-meta">
                          {`${mapSourceLabel(row.source)} | ${formatDate(row.createdAt)}`}
                        </p>
                      </div>

                      <div className="history-item-side">
                        <span className={`history-status history-status--${row.status}`}>
                          {row.status === "legal" ? "Legal" : "Ilegal"}
                        </span>
                        {row.confidence !== null ? (
                          <small className="history-confidence">{`Confianza ${row.confidence}%`}</small>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </article>
          )}
        </section>
      </section>
    </main>
  );
}
