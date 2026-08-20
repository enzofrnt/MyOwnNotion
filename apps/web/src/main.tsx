import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { ThemeProvider } from "./ui/theme-provider.tsx";
import { UiLab } from "./ui/ui-lab.tsx";

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
  void import("./app.tsx").then(({ App }) => render(<App />));
}
