import { type ReactNode, useEffect, useRef } from "react";
import { AppIcon, type AppIconName } from "../../ui/icons.tsx";
import { Button } from "../../ui/primitives/index.ts";

export type SettingsSection =
  | "security"
  | "navigation"
  | "backups"
  | "local-data"
  | "trash"
  | "page-details";

interface SettingsSectionDefinition {
  readonly id: SettingsSection;
  readonly label: string;
  readonly description: string;
  readonly icon: AppIconName;
}

export const SETTINGS_SECTIONS: readonly SettingsSectionDefinition[] = [
  {
    id: "security",
    label: "Sécurité et appareils",
    description: "Accès, sessions, appareils et récupération",
    icon: "lock",
  },
  {
    id: "navigation",
    label: "Navigation",
    description: "Sections visibles dans la barre latérale de cet appareil",
    icon: "panel",
  },
  {
    id: "backups",
    label: "Sauvegardes",
    description: "Protection distante et essais de restauration",
    icon: "archive",
  },
  {
    id: "local-data",
    label: "Stockage et synchronisation",
    description: "Données de cet appareil et changements en attente",
    icon: "sync",
  },
  {
    id: "trash",
    label: "Corbeille",
    description: "Éléments supprimés encore récupérables",
    icon: "delete",
  },
  {
    id: "page-details",
    label: "Page actuelle",
    description: "Identité, relations et historique technique",
    icon: "info",
  },
] as const;

export interface SettingsShellProps {
  readonly activeSection: SettingsSection;
  readonly children: ReactNode;
  readonly onBack: () => void;
  readonly onSectionChange: (section: SettingsSection) => void;
}

/**
 * A destination in its own right, never a panel appended below a document.
 *
 * The active heading receives focus after navigation so a keyboard or screen
 * reader user immediately knows that the workspace has been left. Returning
 * focus and scroll to the document is owned by `App`, which retains the live
 * workspace while this destination is mounted.
 */
export function SettingsShell({
  activeSection,
  children,
  onBack,
  onSectionChange,
}: SettingsShellProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const active = SETTINGS_SECTIONS.find((section) => section.id === activeSection);
  if (active === undefined) {
    throw new Error(`Unknown settings section: ${activeSection}`);
  }

  useEffect(() => {
    if (headingRef.current?.dataset["section"] === activeSection) {
      headingRef.current.focus({ preventScroll: true });
    }
  }, [activeSection]);

  return (
    <div className="settings-shell" data-testid="settings-shell">
      <a className="workspace-skip-link" href="#settings-main">
        Aller aux réglages
      </a>
      <aside className="settings-sidebar">
        <header className="settings-sidebar__header">
          <Button
            className="settings-back"
            variant="ghost"
            data-testid="back-to-workspace"
            onClick={onBack}
          >
            <AppIcon name="arrowLeft" size="small" />
            Retour à l’espace de travail
          </Button>
          <div>
            <span className="settings-eyebrow">MyOwnNotion</span>
            <p className="settings-sidebar__title">Réglages</p>
          </div>
        </header>

        <nav className="settings-navigation" aria-label="Sections des réglages">
          {SETTINGS_SECTIONS.map((section) => (
            <Button
              key={section.id}
              className="settings-navigation__item"
              variant="ghost"
              data-testid={`settings-nav-${section.id}`}
              aria-current={section.id === activeSection ? "page" : undefined}
              onClick={() => onSectionChange(section.id)}
            >
              <AppIcon name={section.icon} />
              <span className="settings-navigation__copy">
                <span>{section.label}</span>
              </span>
            </Button>
          ))}
        </nav>
      </aside>

      <main id="settings-main" className="settings-main" tabIndex={-1}>
        <header className="settings-main__header">
          <span className="settings-eyebrow">Réglages</span>
          <h1
            ref={headingRef}
            tabIndex={-1}
            data-section={activeSection}
            data-testid="settings-heading"
          >
            {active.label}
          </h1>
          <p>{active.description}</p>
        </header>
        <div className="settings-content" data-testid={`settings-section-${activeSection}`}>
          {children}
        </div>
      </main>
    </div>
  );
}
