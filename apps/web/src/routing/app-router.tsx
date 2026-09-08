import { BrowserRouter, HashRouter } from "react-router-dom";
import { App, type AppProps } from "../app.tsx";

function desktopCustomProtocol(): boolean {
  return typeof window !== "undefined" && window.location.protocol === "myownnotion:";
}

export function AppRouter(props: AppProps = {}) {
  const Router = desktopCustomProtocol() ? HashRouter : BrowserRouter;
  return (
    <Router>
      <App {...props} />
    </Router>
  );
}
