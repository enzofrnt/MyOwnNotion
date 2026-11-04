import { Component, type ErrorInfo, type ReactNode } from "react";
import "./error-boundary.css";

interface AppErrorBoundaryState {
  readonly failed: boolean;
}

/**
 * Root safety net.
 *
 * A rendering failure in the editor, a database panel or a settings surface
 * used to unmount the whole tree and leave a blank page with no way back. The
 * boundary keeps a readable, actionable screen that states whether recorded
 * work is affected and offers a reload that preserves the current route.
 */
export class AppErrorBoundary extends Component<
  { readonly children: ReactNode },
  AppErrorBoundaryState
> {
  override state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the diagnostic local: the operator console is the only surface that
    // should see a stack, never the rendered page.
    console.error("unhandled interface error", error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <StartupFailure message="L’interface a rencontré une erreur inattendue et a été arrêtée pour protéger votre travail." />
      );
    }
    return this.props.children;
  }
}

export function StartupFailure({
  message,
  detail,
}: {
  readonly message: string;
  readonly detail?: string;
}): ReactNode {
  return (
    <main className="startup-failure" role="alert">
      <div className="startup-failure__panel">
        <h1 className="startup-failure__title">MyOwnNotion n’a pas pu s’afficher</h1>
        <p className="startup-failure__message">{message}</p>
        <p className="startup-failure__hint">
          Le contenu déjà enregistré n’est pas supprimé. Rechargez la page pour reprendre là où vous
          étiez.
        </p>
        <button
          type="button"
          className="startup-failure__reload"
          onClick={() => window.location.reload()}
        >
          Recharger la page
        </button>
        {detail === undefined ? null : (
          <details className="startup-failure__details">
            <summary>Détails techniques</summary>
            <pre>{detail}</pre>
          </details>
        )}
      </div>
    </main>
  );
}
