import { Navigate, useParams } from "react-router-dom";
import { useAuth } from "../../../app/providers/AuthProvider";
import { HamburgerMenu } from "../components/HamburgerMenu";
import { BANKNOTE_OPTIONS } from "../constants/banknotes";

export function DenominationPage() {
  const { denomination } = useParams<{ denomination: string }>();
  const { loading } = useAuth();
  const selected = BANKNOTE_OPTIONS.find((item) => item.denomination === denomination);

  if (!selected) {
    return <Navigate to="/" replace />;
  }

  return (
    <main className="public-page">
      <section className="public-shell">
        <header className="public-header">
          <HamburgerMenu />
        </header>

        <section className="denomination-placeholder">
          {loading ? (
            <div className="denomination-skeleton skeleton" aria-hidden="true" />
          ) : (
            <h1>{`${selected.denomination} bs`}</h1>
          )}
        </section>
      </section>
    </main>
  );
}
