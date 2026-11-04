import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./global.css";
import { AppErrorBoundary, StartupFailure } from "./ui/error-boundary.tsx";
import { ThemeProvider } from "./ui/theme-provider.tsx";

declare const __MYOWNNOTION_E2E__: boolean;

const container = document.getElementById("root");
if (container === null) {
  throw new Error("root container missing");
}

const root = createRoot(container);

function render(content: ReactNode): void {
  root.render(
    <StrictMode>
      <AppErrorBoundary>
        <ThemeProvider>{content}</ThemeProvider>
      </AppErrorBoundary>
    </StrictMode>,
  );
}

function loadInto<T>(factory: () => Promise<T>, consume: (value: T) => void): void {
  void factory()
    .then(consume)
    .catch((error: unknown) => {
      render(
        <StartupFailure
          message="Le module demandé n’a pas pu être chargé. Vérifiez votre connexion puis rechargez la page."
          {...(error instanceof Error ? { detail: error.message } : {})}
        />,
      );
    });
}

if (window.location.pathname === "/__ui-lab") {
  const query = new URLSearchParams(window.location.search);
  const surface = query.get("surface");
  const review = query.get("review");
  if (review !== null) {
    loadInto(
      async () => {
        const [{ UiLabReview, isReviewSurface }, { UiLab }] = await Promise.all([
          import("./ui/ui-lab-review.tsx"),
          import("./ui/ui-lab.tsx"),
        ]);
        return { UiLabReview, isReviewSurface, UiLab };
      },
      ({ UiLabReview, isReviewSurface, UiLab }) =>
        render(isReviewSurface(review) ? <UiLabReview surface={review} /> : <UiLab />),
    );
  } else if (surface === "login" || surface === "setup" || surface === "connection") {
    loadInto(
      () => import("./ui/ui-lab-auth.tsx"),
      ({ UiLabAuthPreview }) => render(<UiLabAuthPreview surface={surface} />),
    );
  } else {
    loadInto(
      () => import("./ui/ui-lab.tsx"),
      ({ UiLab }) =>
        render(<UiLab compositionView={query.get("view") === "board" ? "board" : "table"} />),
    );
  }
} else {
  // The deterministic UI lab stays out of the production entry. The normal
  // workspace and its editor are loaded only when the application route needs
  // them, and a failed module load now has a readable recovery screen.
  loadInto(
    () => import("./routing/app-router.tsx"),
    ({ AppRouter }) => render(<AppRouter />),
  );
}

// Playwright intercepts requests at the page/context layer, while requests made
// through an active service worker bypass those routes. The dedicated E2E build
// therefore exercises the production application bundle without registering
// the worker; the ordinary production build still ships and registers it.
if (
  !__MYOWNNOTION_E2E__ &&
  import.meta.env.PROD &&
  "serviceWorker" in navigator &&
  window.myownnotionDesktop === undefined
) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/service-worker.js");
  });
}
