import {
  APP_SHORTCUTS,
  FR_COPY,
  formatDateTime,
  formatNumber,
  formatShortcut,
} from "./copy/index.ts";
import { AppIcon } from "./icons.tsx";
import {
  Button,
  DialogContent,
  DialogDescription,
  DialogDismiss,
  DialogHeading,
  DialogRoot,
  DialogTrigger,
  DrawerContent,
  DrawerDescription,
  DrawerDismiss,
  DrawerHeading,
  DrawerRoot,
  DrawerTrigger,
  Field,
  LiveRegion,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
  PopoverContent,
  PopoverDescription,
  PopoverDismiss,
  PopoverHeading,
  PopoverRoot,
  PopoverTrigger,
  Status,
  type StatusKind,
} from "./primitives/index.ts";

export type UiLabOverlay = "none" | "menu" | "popover" | "dialog" | "drawer";

export interface UiLabProps {
  readonly now?: Date;
  readonly overlay?: UiLabOverlay;
}

const CONTENT_COLORS = [
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
] as const;

const STATUS_KINDS: readonly StatusKind[] = [
  "loading",
  "empty",
  "unavailable",
  "offline",
  "error",
  "success",
  "conflict",
  "pending",
  "syncing",
  "info",
];

export function UiLab({
  now = new Date("2026-08-20T12:34:00.000Z"),
  overlay = "none",
}: UiLabProps) {
  return (
    <main className="ui-lab" data-testid="ui-lab">
      <header className="ui-lab__header">
        <span className="ui-lab__eyebrow">Système d’interface</span>
        <h1>Laboratoire MyOwnNotion</h1>
        <p>
          Une surface stable pour contrôler les thèmes, les états et les interactions partagées.
        </p>
      </header>

      <section className="ui-lab__section" aria-labelledby="ui-lab-colors">
        <h2 id="ui-lab-colors">Couleurs de contenu</h2>
        <div className="ui-lab__swatches">
          {CONTENT_COLORS.map((color) => (
            <div className="ui-lab__swatch" data-content-color={color} key={color}>
              <span aria-hidden="true" />
              <code>{color}</code>
            </div>
          ))}
        </div>
      </section>

      <section className="ui-lab__section" aria-labelledby="ui-lab-actions">
        <h2 id="ui-lab-actions">Actions</h2>
        <div className="ui-lab__row">
          <Button variant="primary">
            <AppIcon name="add" /> Créer une page
          </Button>
          <Button variant="secondary">Action secondaire</Button>
          <Button variant="ghost">Action discrète</Button>
          <Button variant="danger">Supprimer</Button>
          <Button disabled>Indisponible</Button>
          <Button busy>Enregistrement</Button>
        </div>
      </section>

      <section className="ui-lab__section" aria-labelledby="ui-lab-fields">
        <h2 id="ui-lab-fields">Champs</h2>
        <div className="ui-lab__grid">
          <Field
            id="lab-title"
            label="Titre de la page"
            description="Visible dans la navigation"
            value="Carnet de recherche"
            readOnly
          />
          <Field
            id="lab-error"
            label="Adresse de sauvegarde"
            error="Cette adresse n’est pas valide"
            value="serveur local"
            readOnly
          />
          <Field id="lab-disabled" label="Identifiant" value="018f…" disabled readOnly />
        </div>
      </section>

      <section className="ui-lab__section" aria-labelledby="ui-lab-statuses">
        <h2 id="ui-lab-statuses">États asynchrones</h2>
        <div className="ui-lab__grid">
          {STATUS_KINDS.map((kind) => (
            <Status kind={kind} key={kind}>
              État présenté avec un texte, une icône et une couleur.
            </Status>
          ))}
        </div>
      </section>

      <section className="ui-lab__section" aria-labelledby="ui-lab-formatting">
        <h2 id="ui-lab-formatting">Locale française</h2>
        <dl className="ui-lab__facts">
          <div>
            <dt>Nombre</dt>
            <dd>{formatNumber(1234567.89)}</dd>
          </div>
          <div>
            <dt>Date</dt>
            <dd>
              {formatDateTime(now, { dateStyle: "long", timeStyle: "short", timeZone: "UTC" })}
            </dd>
          </div>
          <div>
            <dt>Raccourci</dt>
            <dd>
              <kbd>{formatShortcut(APP_SHORTCUTS.search, "mac")}</kbd>
            </dd>
          </div>
        </dl>
      </section>

      <section className="ui-lab__section" aria-labelledby="ui-lab-overlays">
        <h2 id="ui-lab-overlays">Surfaces contextuelles</h2>
        <div className="ui-lab__row">
          <MenuRoot open={overlay === "menu"}>
            <MenuTrigger aria-label={FR_COPY.actions.more}>
              <AppIcon name="more" />
            </MenuTrigger>
            <MenuContent alwaysVisible={overlay === "menu"} portal={false}>
              <MenuLabel>Page</MenuLabel>
              <MenuItem shortcut={formatShortcut(["mod", "r"], "mac")}>Renommer</MenuItem>
              <MenuItem>Dupliquer</MenuItem>
              <MenuSeparator />
              <MenuItem destructive>Placer dans la corbeille</MenuItem>
            </MenuContent>
          </MenuRoot>

          <PopoverRoot open={overlay === "popover"}>
            <PopoverTrigger>Informations</PopoverTrigger>
            <PopoverContent alwaysVisible={overlay === "popover"} portal={false}>
              <PopoverHeading>Informations de la page</PopoverHeading>
              <PopoverDescription>
                Créée aujourd’hui, synchronisée sur deux appareils.
              </PopoverDescription>
              <PopoverDismiss />
            </PopoverContent>
          </PopoverRoot>

          <DialogRoot open={overlay === "dialog"}>
            <DialogTrigger>Confirmation</DialogTrigger>
            <DialogContent alwaysVisible={overlay === "dialog"} portal={false}>
              <DialogHeading>Placer « Carnet de recherche » dans la corbeille ?</DialogHeading>
              <DialogDescription>
                La page pourra être restaurée depuis la corbeille. Aucun contenu ne sera effacé
                immédiatement.
              </DialogDescription>
              <DialogDismiss />
            </DialogContent>
          </DialogRoot>

          <DrawerRoot open={overlay === "drawer"}>
            <DrawerTrigger>Navigation mobile</DrawerTrigger>
            <DrawerContent alwaysVisible={overlay === "drawer"} portal={false}>
              <DrawerHeading>Espace de travail</DrawerHeading>
              <DrawerDescription>
                Pages favorites, récentes et navigation complète.
              </DrawerDescription>
              <DrawerDismiss />
            </DrawerContent>
          </DrawerRoot>
        </div>
      </section>

      <LiveRegion>Laboratoire prêt</LiveRegion>
    </main>
  );
}
