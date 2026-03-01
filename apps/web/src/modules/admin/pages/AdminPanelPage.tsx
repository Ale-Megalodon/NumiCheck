import { useMemo, useState } from "react";
import { BrandWordmark } from "../../../shared/components/ui/BrandWordmark";
import { IllegalRangesEditor } from "../components/IllegalRangesEditor";
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

function formatDate(dateIso: string) {
  try {
    return new Date(dateIso).toLocaleString("es-BO");
  } catch {
    return dateIso;
  }
}

export function AdminPanelPage() {
  const [users, setUsers] = useState<AdminUserRecord[]>(() => getAdminUsers());
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [rangesByDenomination, setRangesByDenomination] = useState(() => getIllegalRanges());
  const [testDenomination, setTestDenomination] = useState<Denomination>("10");
  const [testSerialInput, setTestSerialInput] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);

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
    const confirmed = window.confirm("Restaurar los rangos originales de 10, 20 y 50 Bs?");
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
