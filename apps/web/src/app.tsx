/**
 * Application shell (T018): single development workspace with the
 * hierarchy explorer as its primary surface.
 */
import { HierarchyExplorer } from "./features/hierarchy/hierarchy-explorer.tsx";

export function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>MyOwnNotion</h1>
        <p className="app-subtitle">Canonical content workspace</p>
      </header>
      <main className="app-main">
        <HierarchyExplorer />
      </main>
    </div>
  );
}
