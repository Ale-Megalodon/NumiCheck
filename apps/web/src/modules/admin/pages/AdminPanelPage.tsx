import { useMemo, useState } from "react";
import { BrandWordmark } from "../../../shared/components/ui/BrandWordmark";
import { IllegalRangesEditor } from "../components/IllegalRangesEditor";
import { confirmRangeEdit } from "../utils/rangeSafety";
import {
  createIllegalRange,
  evaluateSeriesAgainstIllegalRanges,
  getIllegalRanges,
  resetIllegalRangesToDefault,
  saveIllegalRanges,
  type Denomination,
  type IllegalRange
} from "../services/illegalRangesStore";
import {
  deleteAdminUser,
  getAdminUsers,
  type AdminUserRecord
} from "../services/adminUsersStore";
import {
  createScanTuningOverride,
  deleteScanTuningOverride,
  getScanTuningOverrides,
  upsertScanTuningOverride,
  type ScanTuningOverride
} from "../../public/utils/scanTuningOverridesStore";

function formatDate(dateIso: string) {
  try {
    return new Date(dateIso).toLocaleString("es-BO");
  } catch {
    return dateIso;
  }
}

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

export function AdminPanelPage() {
  const [users, setUsers] = useState<AdminUserRecord[]>(() => getAdminUsers());
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [rangesByDenomination, setRangesByDenomination] = useState(() => getIllegalRanges());
  const [testDenomination, setTestDenomination] = useState<Denomination>("10");
  const [testSerialInput, setTestSerialInput] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [tuningRows, setTuningRows] = useState<ScanTuningOverride[]>(() => getScanTuningOverrides());
  const [tuningDraft, setTuningDraft] = useState<ScanTuningOverride>(() =>
    createScanTuningOverride({ label: "", userAgentPattern: "" })
  );
  const [tuningNotice, setTuningNotice] = useState<string | null>(null);

  const selectedUser = useMemo(
    () => users.find((user) => user.uid === selectedUserId) ?? null,
    [selectedUserId, users]
  );

  const reloadUsers = () => {
    setUsers(getAdminUsers());
    setSelectedUserId(null);
  };

  const handleDelete = (uid: string) => {
    const confirmed = window.confirm("Eliminar usuario de la tabla del panel?");
    if (!confirmed) {
      return;
    }

    deleteAdminUser(uid);
    setUsers(getAdminUsers());
    if (selectedUserId === uid) {
      setSelectedUserId(null);
    }
  };

  const updateRanges = (denomination: Denomination, nextRows: IllegalRange[]) => {
    const next = {
      ...rangesByDenomination,
      [denomination]: nextRows
    };

    setRangesByDenomination(next);
    saveIllegalRanges(next);
  };

  const addRow = (denomination: Denomination) => {
    const current = rangesByDenomination[denomination];
    updateRanges(denomination, [...current, createIllegalRange()]);
  };

  const resetAllRanges = () => {
    const confirmed = confirmRangeEdit("Restaurar los rangos originales de 10, 20 y 50 Bs");
    if (!confirmed) {
      return;
    }

    const defaults = resetIllegalRangesToDefault();
    setRangesByDenomination(defaults);
    setTestResult(null);
  };

  const runQuickValidation = () => {
    const evaluation = evaluateSeriesAgainstIllegalRanges(testDenomination, testSerialInput);
    const prefix =
      evaluation.status === "illegal"
        ? "ILEGAL"
        : evaluation.status === "legal"
          ? "LEGAL"
          : "INVALIDO";

    const rangeInfo =
      evaluation.matchedRange
        ? ` | Rango: ${evaluation.matchedRange.start} - ${evaluation.matchedRange.end}`
        : "";

    setTestResult(`${prefix}: ${evaluation.reason}${rangeInfo}`);
  };

  const reloadTuningRows = () => {
    setTuningRows(getScanTuningOverrides());
  };

  const resetTuningDraft = () => {
    setTuningDraft(createScanTuningOverride({ label: "", userAgentPattern: "" }));
  };

  const saveTuningDraft = () => {
    if (!tuningDraft.userAgentPattern.trim()) {
      setTuningNotice("Debes ingresar un patron de User-Agent para identificar el modelo.");
      return;
    }

    upsertScanTuningOverride(tuningDraft);
    reloadTuningRows();
    resetTuningDraft();
    setTuningNotice("Perfil de tuning guardado.");
  };

  const handleDeleteTuning = (id: string) => {
    const confirmed = window.confirm("Eliminar este perfil de tuning?");
    if (!confirmed) {
      return;
    }

    deleteScanTuningOverride(id);
    reloadTuningRows();
    if (tuningDraft.id === id) {
      resetTuningDraft();
    }
    setTuningNotice("Perfil eliminado.");
  };

  const updateTuningPatch = (key: keyof ScanTuningOverride["patch"], value: string) => {
    const numeric = parseOptionalNumber(value);
    setTuningDraft((prev) => ({
      ...prev,
      patch: {
        ...prev.patch,
        [key]: numeric
      }
    }));
  };

  return (
    <main className="admin-page">
      <section className="admin-shell">
        <header className="admin-header">
          <div>
            <p className="admin-kicker">Ruta secreta interna</p>
            <h1>PANEL DE ADMINISTRADOR</h1>
          </div>
          <BrandWordmark weight="semibold" />
        </header>

        <section className="admin-card">
          <div className="admin-card-head">
            <h2>Usuarios registrados</h2>
            <button type="button" className="menu-toggle" onClick={reloadUsers}>
              Actualizar
            </button>
          </div>

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Consultas</th>
                  <th>Ultimo acceso</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={4}>Aun no hay usuarios registrados.</td>
                  </tr>
                ) : (
                  users.map((user) => (
                    <tr key={user.uid}>
                      <td>
                        <p className="admin-user-name">{user.displayName}</p>
                        <p className="admin-user-email">{user.email}</p>
                      </td>
                      <td>{user.totalQueries}</td>
                      <td>{formatDate(user.lastLoginAt)}</td>
                      <td>
                        <div className="admin-actions">
                          <button
                            type="button"
                            className="home-menu-item"
                            onClick={() => setSelectedUserId(user.uid)}
                          >
                            Info
                          </button>
                          <button
                            type="button"
                            className="home-menu-item home-menu-item--danger"
                            onClick={() => handleDelete(user.uid)}
                          >
                            Eliminar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {selectedUser ? (
          <section className="admin-card">
            <h2>Info de usuario</h2>
            <p>
              <strong>Nombre:</strong> {selectedUser.displayName}
            </p>
            <p>
              <strong>Email:</strong> {selectedUser.email}
            </p>
            <p>
              <strong>Consultas totales:</strong> {selectedUser.totalQueries}
            </p>
            <p>
              <strong>Legales:</strong> {selectedUser.legalQueries}
            </p>
            <p>
              <strong>Ilegales:</strong> {selectedUser.illegalQueries}
            </p>
            <p>
              <strong>Registro:</strong> {formatDate(selectedUser.createdAt)}
            </p>
            <p>
              <strong>Ultimo acceso:</strong> {formatDate(selectedUser.lastLoginAt)}
            </p>
          </section>
        ) : null}

        <section className="admin-card">
          <div className="admin-card-head">
            <h2>Prueba rapida de verificacion (Serie B)</h2>
            <button type="button" className="menu-toggle" onClick={resetAllRanges}>
              Restaurar rangos base
            </button>
          </div>

          <div className="admin-quick-grid">
            <label className="admin-field">
              <span>Denominacion</span>
              <select
                className="admin-input"
                value={testDenomination}
                onChange={(event) => setTestDenomination(event.target.value as Denomination)}
              >
                <option value="10">10 Bs</option>
                <option value="20">20 Bs</option>
                <option value="50">50 Bs</option>
              </select>
            </label>

            <label className="admin-field">
              <span>Serie (ej: 77100001 B)</span>
              <input
                className="admin-input"
                type="text"
                placeholder="123456789 B"
                value={testSerialInput}
                onChange={(event) => setTestSerialInput(event.target.value)}
              />
            </label>
          </div>

          <div className="admin-quick-actions">
            <button type="button" className="auth-button" onClick={runQuickValidation}>
              Verificar
            </button>
          </div>

          {testResult ? <p className="admin-test-result">{testResult}</p> : null}
        </section>

        <section className="admin-card">
          <div className="admin-card-head">
            <h2>Tuning de escaner por modelo</h2>
            <button type="button" className="menu-toggle" onClick={reloadTuningRows}>
              Actualizar
            </button>
          </div>

          <div className="admin-quick-grid">
            <label className="admin-field">
              <span>Etiqueta</span>
              <input
                className="admin-input"
                type="text"
                placeholder="Ej: Redmi Note 12"
                value={tuningDraft.label}
                onChange={(event) => setTuningDraft((prev) => ({ ...prev, label: event.target.value }))}
              />
            </label>

            <label className="admin-field">
              <span>Patron User-Agent (obligatorio)</span>
              <input
                className="admin-input"
                type="text"
                placeholder="Ej: Redmi Note 12"
                value={tuningDraft.userAgentPattern}
                onChange={(event) =>
                  setTuningDraft((prev) => ({
                    ...prev,
                    userAgentPattern: event.target.value
                  }))
                }
              />
            </label>

            <label className="admin-field">
              <span>Denominacion</span>
              <select
                className="admin-input"
                value={tuningDraft.denomination}
                onChange={(event) =>
                  setTuningDraft((prev) => ({
                    ...prev,
                    denomination: event.target.value as ScanTuningOverride["denomination"]
                  }))
                }
              >
                <option value="all">Todas</option>
                <option value="10">10 Bs</option>
                <option value="20">20 Bs</option>
                <option value="50">50 Bs</option>
              </select>
            </label>

            <label className="admin-field">
              <span>Tier forzado</span>
              <select
                className="admin-input"
                value={tuningDraft.tierOverride}
                onChange={(event) =>
                  setTuningDraft((prev) => ({
                    ...prev,
                    tierOverride: event.target.value as ScanTuningOverride["tierOverride"]
                  }))
                }
              >
                <option value="auto">auto</option>
                <option value="low">low</option>
                <option value="mid">mid</option>
                <option value="high">high</option>
              </select>
            </label>
          </div>

          <p className="admin-note">Deja vacio un campo numerico para usar el valor automatico.</p>

          <div className="admin-inline-grid">
            <label className="admin-field">
              <span>baseDelayMs</span>
              <input
                className="admin-input"
                type="number"
                value={tuningDraft.patch.baseDelayMs ?? ""}
                onChange={(event) => updateTuningPatch("baseDelayMs", event.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>ocrMissDelayMs</span>
              <input
                className="admin-input"
                type="number"
                value={tuningDraft.patch.ocrMissDelayMs ?? ""}
                onChange={(event) => updateTuningPatch("ocrMissDelayMs", event.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>readHitDelayMs</span>
              <input
                className="admin-input"
                type="number"
                value={tuningDraft.patch.readHitDelayMs ?? ""}
                onChange={(event) => updateTuningPatch("readHitDelayMs", event.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>requiredHits</span>
              <input
                className="admin-input"
                type="number"
                value={tuningDraft.patch.requiredHits ?? ""}
                onChange={(event) => updateTuningPatch("requiredHits", event.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>fastAcceptConfidence</span>
              <input
                className="admin-input"
                type="number"
                value={tuningDraft.patch.fastAcceptConfidence ?? ""}
                onChange={(event) => updateTuningPatch("fastAcceptConfidence", event.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>immediateAcceptConfidence</span>
              <input
                className="admin-input"
                type="number"
                value={tuningDraft.patch.immediateAcceptConfidence ?? ""}
                onChange={(event) => updateTuningPatch("immediateAcceptConfidence", event.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>qualityAcceptFloor</span>
              <input
                className="admin-input"
                type="number"
                value={tuningDraft.patch.qualityAcceptFloor ?? ""}
                onChange={(event) => updateTuningPatch("qualityAcceptFloor", event.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>maxOcrMs</span>
              <input
                className="admin-input"
                type="number"
                value={tuningDraft.patch.maxOcrMs ?? ""}
                onChange={(event) => updateTuningPatch("maxOcrMs", event.target.value)}
              />
            </label>
          </div>

          <div className="admin-quick-actions">
            <button type="button" className="auth-button" onClick={saveTuningDraft}>
              Guardar perfil
            </button>
            <button type="button" className="menu-toggle" onClick={resetTuningDraft}>
              Limpiar
            </button>
          </div>

          {tuningNotice ? <p className="admin-test-result">{tuningNotice}</p> : null}

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Etiqueta</th>
                  <th>Patron</th>
                  <th>Denominacion</th>
                  <th>Tier</th>
                  <th>Activo</th>
                  <th>Accion</th>
                </tr>
              </thead>
              <tbody>
                {tuningRows.length === 0 ? (
                  <tr>
                    <td colSpan={6}>Aun no hay perfiles de tuning.</td>
                  </tr>
                ) : (
                  tuningRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.label}</td>
                      <td>{row.userAgentPattern}</td>
                      <td>{row.denomination}</td>
                      <td>{row.tierOverride}</td>
                      <td>
                        <label className="admin-switch">
                          <input
                            type="checkbox"
                            checked={row.enabled}
                            onChange={(event) => {
                              upsertScanTuningOverride({ ...row, enabled: event.target.checked });
                              reloadTuningRows();
                            }}
                          />
                          <span>{row.enabled ? "Si" : "No"}</span>
                        </label>
                      </td>
                      <td>
                        <div className="admin-actions">
                          <button
                            type="button"
                            className="home-menu-item"
                            onClick={() => {
                              setTuningDraft(row);
                              setTuningNotice("Editando perfil existente.");
                            }}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            className="home-menu-item home-menu-item--danger"
                            onClick={() => handleDeleteTuning(row.id)}
                          >
                            Eliminar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <IllegalRangesEditor
          denomination="10"
          title="10 Bs"
          rows={rangesByDenomination["10"]}
          onChange={(nextRows) => updateRanges("10", nextRows)}
          onAddRow={() => addRow("10")}
        />

        <IllegalRangesEditor
          denomination="20"
          title="20 Bs"
          rows={rangesByDenomination["20"]}
          onChange={(nextRows) => updateRanges("20", nextRows)}
          onAddRow={() => addRow("20")}
        />

        <IllegalRangesEditor
          denomination="50"
          title="50 Bs"
          rows={rangesByDenomination["50"]}
          onChange={(nextRows) => updateRanges("50", nextRows)}
          onAddRow={() => addRow("50")}
        />
      </section>
    </main>
  );
}
