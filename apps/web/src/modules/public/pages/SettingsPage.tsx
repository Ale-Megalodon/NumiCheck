import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../app/providers/AuthProvider";
import { HamburgerMenu } from "../components/HamburgerMenu";
import { PublicBrand } from "../components/PublicBrand";
import {
  getPublicUserSettings,
  resetPublicUserScanPatch,
  savePublicUserSettings,
  type PublicUserSettings,
  type UserScanPatch
} from "../services/publicUserSettingsStore";

function parseOptionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return parsed;
}

function toInputValue(value: number | undefined) {
  return typeof value === "number" ? String(value) : "";
}

export function SettingsPage() {
  const navigate = useNavigate();
  const { loading, user } = useAuth();
  const [settings, setSettings] = useState<PublicUserSettings>(() => getPublicUserSettings(user?.uid));
  const [hydrating, setHydrating] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (loading) {
      return;
    }

    setSettings(getPublicUserSettings(user?.uid));
    setHydrating(true);
    const timer = window.setTimeout(() => setHydrating(false), 320);
    return () => window.clearTimeout(timer);
  }, [loading, user?.uid]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timer = window.setTimeout(() => setNotice(null), 1900);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const loadingState = loading || hydrating;

  const updatePatchField = (key: keyof UserScanPatch, value: string) => {
    const parsed = parseOptionalNumber(value);
    setSettings((prev) => ({
      ...prev,
      scanPatch: {
        ...prev.scanPatch,
        [key]: parsed
      }
    }));
  };

  const persistSettings = (next: Partial<PublicUserSettings>) => {
    const saved = savePublicUserSettings(user?.uid, next);
    setSettings(saved);
  };

  const setDarkMode = (enabled: boolean) => {
    persistSettings({ darkMode: enabled });
    setNotice(enabled ? "Modo oscuro activado." : "Modo oscuro desactivado.");
  };

  const saveScanPatch = () => {
    persistSettings({ scanPatch: settings.scanPatch });
    setNotice("Velocidad de escaneo guardada para tu cuenta.");
  };

  const resetScanPatch = () => {
    const saved = resetPublicUserScanPatch(user?.uid);
    setSettings(saved);
    setNotice("Velocidad restablecida a valores por defecto.");
  };

  if (!loading && !user) {
    return (
      <main className="public-page">
        <section className="public-shell">
          <header className="public-header">
            <HamburgerMenu />
            <PublicBrand loading={loading} user={user} />
          </header>

          <section className="settings-shell">
            <article className="settings-card">
              <h1 className="settings-title">Configuracion</h1>
              <p className="settings-note">Inicia sesion para personalizar modo oscuro y velocidad de escaneo.</p>
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

        <section className="settings-shell">
          {loadingState ? (
            <article className="settings-card settings-card--skeleton" aria-hidden="true">
              <div className="settings-title-skeleton skeleton" />
              <div className="settings-button-row-skeleton skeleton" />
              <div className="settings-grid-skeleton skeleton" />
              <div className="settings-grid-skeleton skeleton" />
              <div className="settings-button-row-skeleton skeleton" />
            </article>
          ) : (
            <article className="settings-card">
              <h1 className="settings-title">Configuracion</h1>
              <p className="settings-note">Todo lo que cambies aqui solo afecta a tu cuenta.</p>

              <section className="settings-section">
                <h2>Activar modo oscuro</h2>
                <div className="settings-dark-toggle">
                  <button
                    type="button"
                    className={`settings-toggle-button ${settings.darkMode ? "settings-toggle-button--selected" : ""}`}
                    onClick={() => setDarkMode(true)}
                  >
                    Activar
                  </button>
                  <button
                    type="button"
                    className={`settings-toggle-button ${!settings.darkMode ? "settings-toggle-button--selected" : ""}`}
                    onClick={() => setDarkMode(false)}
                  >
                    Desactivar
                  </button>
                </div>
              </section>

              <section className="settings-section">
                <h2>Configurar velocidad de escaneo</h2>
                <p className="settings-note">Tabla personalizada para tu cuenta (igual estilo del admin).</p>

                <div className="settings-grid">
                  <label className="admin-field">
                    <span>baseDelayMs</span>
                    <input
                      className="admin-input"
                      type="number"
                      value={toInputValue(settings.scanPatch.baseDelayMs)}
                      onChange={(event) => updatePatchField("baseDelayMs", event.target.value)}
                    />
                  </label>
                  <label className="admin-field">
                    <span>ocrMissDelayMs</span>
                    <input
                      className="admin-input"
                      type="number"
                      value={toInputValue(settings.scanPatch.ocrMissDelayMs)}
                      onChange={(event) => updatePatchField("ocrMissDelayMs", event.target.value)}
                    />
                  </label>
                  <label className="admin-field">
                    <span>readHitDelayMs</span>
                    <input
                      className="admin-input"
                      type="number"
                      value={toInputValue(settings.scanPatch.readHitDelayMs)}
                      onChange={(event) => updatePatchField("readHitDelayMs", event.target.value)}
                    />
                  </label>
                  <label className="admin-field">
                    <span>requiredHits</span>
                    <input
                      className="admin-input"
                      type="number"
                      value={toInputValue(settings.scanPatch.requiredHits)}
                      onChange={(event) => updatePatchField("requiredHits", event.target.value)}
                    />
                  </label>
                  <label className="admin-field">
                    <span>fastAcceptConfidence</span>
                    <input
                      className="admin-input"
                      type="number"
                      value={toInputValue(settings.scanPatch.fastAcceptConfidence)}
                      onChange={(event) => updatePatchField("fastAcceptConfidence", event.target.value)}
                    />
                  </label>
                  <label className="admin-field">
                    <span>immediateAcceptConfidence</span>
                    <input
                      className="admin-input"
                      type="number"
                      value={toInputValue(settings.scanPatch.immediateAcceptConfidence)}
                      onChange={(event) => updatePatchField("immediateAcceptConfidence", event.target.value)}
                    />
                  </label>
                  <label className="admin-field">
                    <span>qualityAcceptFloor</span>
                    <input
                      className="admin-input"
                      type="number"
                      value={toInputValue(settings.scanPatch.qualityAcceptFloor)}
                      onChange={(event) => updatePatchField("qualityAcceptFloor", event.target.value)}
                    />
                  </label>
                  <label className="admin-field">
                    <span>maxOcrMs</span>
                    <input
                      className="admin-input"
                      type="number"
                      value={toInputValue(settings.scanPatch.maxOcrMs)}
                      onChange={(event) => updatePatchField("maxOcrMs", event.target.value)}
                    />
                  </label>
                </div>

                <div className="settings-actions">
                  <button type="button" className="auth-button" onClick={saveScanPatch}>
                    Guardar velocidad
                  </button>
                  <button type="button" className="menu-toggle" onClick={resetScanPatch}>
                    Restablecer
                  </button>
                </div>
              </section>

              {notice ? <p className="settings-notice">{notice}</p> : null}
            </article>
          )}
        </section>
      </section>
    </main>
  );
}
