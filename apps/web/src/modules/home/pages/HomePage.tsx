import { useAuth } from "../../../app/providers/AuthProvider";

export function HomePage() {
  const { user, logout } = useAuth();

  return (
    <main className="home-page">
      <section className="home-card">
        <h2>Proximo!</h2>
        <p>Sesion activa: {user?.email ?? "sin correo"}</p>
        <button type="button" className="auth-button" onClick={logout}>
          Cerrar sesion
        </button>
      </section>
    </main>
  );
}