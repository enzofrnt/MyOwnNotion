import { BrowserRouter } from "react-router-dom";
import { App, type AppProps } from "../app.tsx";

export function AppRouter(props: AppProps = {}) {
  return (
    <BrowserRouter>
      <App {...props} />
    </BrowserRouter>
  );
}
