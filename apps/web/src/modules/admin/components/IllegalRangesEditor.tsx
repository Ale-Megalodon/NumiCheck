import { useEffect, useState } from "react";
import type { Denomination, IllegalRange } from "../services/illegalRangesStore";
import { confirmRangeEdit } from "../utils/rangeSafety";

type IllegalRangesEditorProps = {
  denomination: Denomination;
  title: string;
  rows: IllegalRange[];
  onChange: (rows: IllegalRange[]) => void;
  onAddRow: () => void;
};

export function IllegalRangesEditor({
  denomination,
  title,
  rows,
  onChange,
  onAddRow
}: IllegalRangesEditorProps) {
  const [draftRows, setDraftRows] = useState<IllegalRange[]>(rows);

  useEffect(() => {
    setDraftRows(rows);
  }, [rows]);

  const updateDraftRow = (id: string, patch: Partial<IllegalRange>) => {
    setDraftRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const addRow = () => {
    if (!confirmRangeEdit(`Tabla ${title}: agregar nuevo rango`)) {
      return;
    }

    onAddRow();
  };

  const saveRow = (id: string) => {
    const draft = draftRows.find((row) => row.id === id);
    const persisted = rows.find((row) => row.id === id);
    if (!draft || !persisted) {
      return;
    }

    if (draft.start > draft.end) {
      window.alert("Rango invalido: el inicio no puede ser mayor que el fin.");
      return;
    }

    const changed =
      draft.start !== persisted.start || draft.end !== persisted.end || draft.active !== persisted.active;

    if (!changed) {
      return;
    }

    if (!confirmRangeEdit(`Tabla ${title}: guardar cambios del rango #${rows.indexOf(persisted) + 1}`)) {
      return;
    }

    onChange(rows.map((row) => (row.id === id ? draft : row)));
  };

  const removeRow = (id: string) => {
    if (!confirmRangeEdit(`Tabla ${title}: eliminar rango`)) {
      return;
    }

    onChange(rows.filter((row) => row.id !== id));
  };

  return (
    <section className="admin-card">
      <div className="admin-card-head">
        <h2>Tabla {title}</h2>
        <button type="button" className="menu-toggle" onClick={addRow}>
          Agregar rango
        </button>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Inicio</th>
              <th>Fin</th>
              <th>Activo</th>
              <th>Accion</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5}>Sin rangos en tabla {denomination} bs.</td>
              </tr>
            ) : (
              draftRows.map((row, index) => {
                const invalid = row.start > row.end;
                const persisted = rows.find((stored) => stored.id === row.id);
                const changed = persisted
                  ? row.start !== persisted.start || row.end !== persisted.end || row.active !== persisted.active
                  : false;
                return (
                  <tr key={row.id} className={invalid ? "admin-row-invalid" : ""}>
                    <td>{index + 1}</td>
                    <td>
                      <input
                        className="admin-input"
                        type="number"
                        min={0}
                        value={row.start}
                        onChange={(event) =>
                          updateDraftRow(row.id, { start: Number(event.target.value || 0) })
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="admin-input"
                        type="number"
                        min={0}
                        value={row.end}
                        onChange={(event) =>
                          updateDraftRow(row.id, { end: Number(event.target.value || 0) })
                        }
                      />
                    </td>
                    <td>
                      <label className="admin-switch">
                        <input
                          type="checkbox"
                          checked={row.active}
                          onChange={(event) => updateDraftRow(row.id, { active: event.target.checked })}
                        />
                        <span>{row.active ? "Si" : "No"}</span>
                      </label>
                    </td>
                    <td>
                      <div className="admin-actions">
                        <button
                          type="button"
                          className="home-menu-item"
                          disabled={!changed}
                          onClick={() => saveRow(row.id)}
                        >
                          Guardar
                        </button>
                        <button
                          type="button"
                          className="home-menu-item home-menu-item--danger"
                          onClick={() => removeRow(row.id)}
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="admin-note">
        Regla: si la serie numerica cae dentro de un rango activo de {denomination} bs y la letra es B, el billete
        se marca como ILEGAL.
      </p>
    </section>
  );
}
