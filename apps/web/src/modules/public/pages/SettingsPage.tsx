import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../app/providers/AuthProvider";
import { HamburgerMenu } from "../components/HamburgerMenu";
import { BackHomeButton } from "../components/BackHomeButton";
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
  const [showAdvanced, setShowAdvanced] = useState(false);

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
        <BackHomeButton loading={loading} />

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
                <p className="settings-note">Tuning por cuenta (estilo consola admin). Aplica solo a tu perfil.</p>

                <div className="admin-quick-grid">
                  <label className="admin-field">
                    <span>readHitDelayMs (pausa entre lecturas validas; menor = mas rapido)</span>
                    <input
                      className="admin-input"
                      type="number"
                      value={toInputValue(settings.scanPatch.readHitDelayMs)}
                      onChange={(event) => updatePatchField("readHitDelayMs", event.target.value)}
                    />
                  </label>
                  <label className="admin-field">
                    <span>fastAcceptConfidence (confianza minima para aceptar rapido)</span>
                    <input
                      className="admin-input"
                      type="number"
                      value={toInputValue(settings.scanPatch.fastAcceptConfidence)}
                      onChange={(event) => updatePatchField("fastAcceptConfidence", event.target.value)}
                    />
                  </label>
                </div>

                <div className="admin-inline-actions">
                  <button type="button" className="menu-toggle" onClick={() => setShowAdvanced((prev) => !prev)}>
                    {showAdvanced ? "Ocultar ajustes avanzados" : "Mostrar ajustes avanzados"}
                  </button>
                </div>

                {showAdvanced ? (
                  <>
                    <p className="admin-note">Deja vacio un campo para mantener el valor automatico.</p>

                    <div className="admin-inline-grid">
                      <label className="admin-field">
                        <span>baseDelayMs (espera base entre capturas)</span>
                        <input
                          className="admin-input"
                          type="number"
                          value={toInputValue(settings.scanPatch.baseDelayMs)}
                          onChange={(event) => updatePatchField("baseDelayMs", event.target.value)}
                        />
                      </label>
                      <label className="admin-field">
                        <span>ocrMissDelayMs (espera cuando OCR falla)</span>
                        <input
                          className="admin-input"
                          type="number"
                          value={toInputValue(settings.scanPatch.ocrMissDelayMs)}
                          onChange={(event) => updatePatchField("ocrMissDelayMs", event.target.value)}
                        />
                      </label>
                      <label className="admin-field">
                        <span>readHitDelayMs (espera entre lecturas buenas)</span>
                        <input
                          className="admin-input"
                          type="number"
                          value={toInputValue(settings.scanPatch.readHitDelayMs)}
                          onChange={(event) => updatePatchField("readHitDelayMs", event.target.value)}
                        />
                      </label>
                      <label className="admin-field">
                        <span>requiredHits (lecturas seguidas para confirmar)</span>
                        <input
                          className="admin-input"
                          type="number"
                          value={toInputValue(settings.scanPatch.requiredHits)}
                          onChange={(event) => updatePatchField("requiredHits", event.target.value)}
                        />
                      </label>
                      <label className="admin-field">
                        <span>fastAcceptConfidence (umbral de aceptacion rapida)</span>
                        <input
                          className="admin-input"
                          type="number"
                          value={toInputValue(settings.scanPatch.fastAcceptConfidence)}
                          onChange={(event) => updatePatchField("fastAcceptConfidence", event.target.value)}
                        />
                      </label>
                      <label className="admin-field">
                        <span>immediateAcceptConfidence (aceptacion inmediata)</span>
                        <input
                          className="admin-input"
                          type="number"
                          value={toInputValue(settings.scanPatch.immediateAcceptConfidence)}
                          onChange={(event) => updatePatchField("immediateAcceptConfidence", event.target.value)}
                        />
                      </label>
                      <label className="admin-field">
                        <span>qualityAcceptFloor (piso minimo de calidad)</span>
                        <input
                          className="admin-input"
                          type="number"
                          value={toInputValue(settings.scanPatch.qualityAcceptFloor)}
                          onChange={(event) => updatePatchField("qualityAcceptFloor", event.target.value)}
                        />
                      </label>
                      <label className="admin-field">
                        <span>maxOcrMs (tiempo maximo por lectura OCR)</span>
                        <input
                          className="admin-input"
                          type="number"
                          value={toInputValue(settings.scanPatch.maxOcrMs)}
                          onChange={(event) => updatePatchField("maxOcrMs", event.target.value)}
                        />
                      </label>
                    </div>
                  </>
                ) : (
                  <p className="admin-note">Modo simple activo: usa ajustes turbo recomendados por defecto.</p>
                )}

                <div className="settings-grid">
                  <label className="admin-field">
                    <span>qualityAcceptFloor (calidad minima para aceptar)</span>
                    <input
                      className="admin-input"
                      type="number"
                      value={toInputValue(settings.scanPatch.qualityAcceptFloor)}
                      onChange={(event) => updatePatchField("qualityAcceptFloor", event.target.value)}
                    />
                  </label>
                  <label className="admin-field">
                    <span>maxOcrMs (tope de tiempo OCR por intento)</span>
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
