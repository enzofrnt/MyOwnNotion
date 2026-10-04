import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./global.css";
import { ThemeProvider } from "./ui/theme-provider.tsx";
import { UiLab } from "./ui/ui-lab.tsx";
import { UiLabAuthPreview } from "./ui/ui-lab-auth.tsx";

declare const __MYOWNNOTION_E2E__: boolean;

const container = document.getElementById("root");
if (container === null) {
  throw new Error("root container missing");
}

const root = createRoot(container);

function render(content: ReactNode): void {
  root.render(
    <StrictMode>
      <ThemeProvider>{content}</ThemeProvider>
    </StrictMode>,
  );
}

if (window.location.pathname === "/__ui-lab") {
  const query = new URLSearchParams(window.location.search);
  const surface = query.get("surface");
  const review = query.get("review");
  if (review !== null) {
    void import("./ui/ui-lab-review.tsx").then(({ UiLabReview, isReviewSurface }) =>
      render(isReviewSurface(review) ? <UiLabReview surface={review} /> : <UiLab />),
    );
  } else
    render(
      surface === "login" || surface === "setup" || surface === "connection" ? (
        <UiLabAuthPreview surface={surface} />
      ) : (
        <UiLab compositionView={query.get("view") === "board" ? "board" : "table"} />
      ),
    );
} else {
  // The deterministic UI lab must stay independent from API and CRDT startup.
  // The normal workspace remains a separate chunk and is loaded only here.
  void import("./routing/app-router.tsx").then(({ AppRouter }) => render(<AppRouter />));
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
