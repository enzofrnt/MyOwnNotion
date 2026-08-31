import { Button, Status } from "../../ui/primitives/index.ts";

export function NotFoundPage({ onReturn }: { readonly onReturn: () => void }) {
  return (
    <main className="app-shell" data-testid="route-not-found">
      <Status kind="error" title="Cette page est introuvable">
        L’adresse ne correspond à aucune page disponible de MyOwnNotion.
      </Status>
      <Button onClick={onReturn}>Retour aux notes</Button>
    </main>
  );
}
