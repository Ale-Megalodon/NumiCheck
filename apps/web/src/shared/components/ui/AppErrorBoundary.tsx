import { Component, type ErrorInfo, type ReactNode } from "react";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  hasError: boolean;
};

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  public constructor(props: AppErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  public static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Unhandled UI error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <main className="status-screen">
          <section className="auth-card">
            <h2>Error inesperado</h2>
            <p>Recarga la pagina para continuar.</p>
            <button type="button" className="auth-button" onClick={() => window.location.reload()}>
              Recargar
            </button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
