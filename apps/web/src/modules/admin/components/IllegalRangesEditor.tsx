import type { Denomination, IllegalRange } from "../services/illegalRangesStore";

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
  const updateRow = (id: string, patch: Partial<IllegalRange>) => {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const removeRow = (id: string) => {
    onChange(rows.filter((row) => row.id !== id));
  };

  return (
    <section className="admin-card">
      <div className="admin-card-head">
        <h2>Tabla {title}</h2>
        <button type="button" className="menu-toggle" onClick={onAddRow}>
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
              rows.map((row, index) => {
                const invalid = row.start > row.end;
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
                          updateRow(row.id, { start: Number(event.target.value || 0) })
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
                          updateRow(row.id, { end: Number(event.target.value || 0) })
                        }
                      />
                    </td>
                    <td>
                      <label className="admin-switch">
                        <input
                          type="checkbox"
                          checked={row.active}
                          onChange={(event) => updateRow(row.id, { active: event.target.checked })}
                        />
                        <span>{row.active ? "Si" : "No"}</span>
                      </label>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="home-menu-item home-menu-item--danger"
                        onClick={() => removeRow(row.id)}
                      >
                        Eliminar
                      </button>
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

