import { HamburgerMenu } from "../components/HamburgerMenu";
import { useAuth } from "../../../app/providers/AuthProvider";

type FeaturePlaceholderPageProps = {
  title: string;
};

export function FeaturePlaceholderPage({ title }: FeaturePlaceholderPageProps) {
  const { loading } = useAuth();

  return (
    <main className="public-page">
      <section className="public-shell">
        <header className="public-header">
          <HamburgerMenu />
        </header>

        <section className="denomination-placeholder">
          {loading ? <div className="denomination-skeleton skeleton" aria-hidden="true" /> : <h1>{title}</h1>}
        </section>
      </section>
    </main>
  );
}
