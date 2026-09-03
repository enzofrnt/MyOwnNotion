import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./global.css";
import { ThemeProvider } from "./ui/theme-provider.tsx";
import { UiLab } from "./ui/ui-lab.tsx";

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
  render(<UiLab />);
} else {
  // The deterministic UI lab must stay independent from API and CRDT startup.
  // The normal workspace remains a separate chunk and is loaded only here.
  void import("./routing/app-router.tsx").then(({ AppRouter }) => render(<AppRouter />));
}

// Playwright intercepts requests at the page/context layer, while requests made
// through an active service worker bypass those routes. The dedicated E2E build
// therefore exercises the production application bundle without registering
// the worker; the ordinary production build still ships and registers it.
if (!__MYOWNNOTION_E2E__ && import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/service-worker.js");
  });
}
