import { useMemo, useState } from "react";
import { BrandWordmark } from "../../../shared/components/ui/BrandWordmark";
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

  const selectedUser = useMemo(
    () => users.find((user) => user.uid === selectedUserId) ?? null,
    [selectedUserId, users]
  );

  const reloadUsers = () => {
    setUsers(getAdminUsers());
    setSelectedUserId(null);
  };

  const handleDelete = (uid: string) => {
    const confirmed = window.confirm("¿Eliminar usuario de la tabla del panel?");
    if (!confirmed) {
      return;
    }

    deleteAdminUser(uid);
    setUsers(getAdminUsers());
    if (selectedUserId === uid) {
      setSelectedUserId(null);
    }
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
      </section>
    </main>
  );
}

