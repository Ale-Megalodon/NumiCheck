import { useNavigate } from "react-router-dom";

type BackHomeButtonProps = {
  loading?: boolean;
};

export function BackHomeButton({ loading = false }: BackHomeButtonProps) {
  const navigate = useNavigate();

  if (loading) {
    return <div className="back-home-skeleton skeleton" aria-hidden="true" />;
  }

  return (
    <button type="button" className="back-home-button" onClick={() => navigate("/")}>
      Volver al inicio
    </button>
  );
}
