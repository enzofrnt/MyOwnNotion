import { type ReactNode, useEffect, useRef } from "react";
import { AppIcon, type AppIconName } from "../../ui/icons.tsx";
import { Button } from "../../ui/primitives/index.ts";

export type SettingsSection =
  | "account"
  | "administration"
  | "security"
  | "backups"
  | "local-data"
  | "trash"
  | "page-details";

/** Sections only the administrator reaches (feature 058). */
export const ADMINISTRATOR_SECTIONS: ReadonlySet<SettingsSection> = new Set([
  "administration",
  "backups",
]);

interface SettingsSectionDefinition {
  readonly id: SettingsSection;
  readonly label: string;
  readonly description: string;
  readonly icon: AppIconName;
  readonly group: SettingsGroup;
}

type SettingsGroup = "personal" | "installation" | "data";

const SETTINGS_GROUPS: readonly { readonly id: SettingsGroup; readonly label: string }[] = [
  { id: "personal", label: "Personnel" },
  { id: "installation", label: "Installation" },
  { id: "data", label: "Données" },
];

export const SETTINGS_SECTIONS: readonly SettingsSectionDefinition[] = [
  {
    id: "account",
    label: "Compte",
    description: "Pseudo, adresse e-mail et déconnexion",
    icon: "user",
    group: "personal",
  },
  {
    id: "administration",
    label: "Administration",
    description: "Utilisateurs, inscription et liens d’invitation",
    icon: "users",
    group: "installation",
  },
  {
    id: "security",
    label: "Sécurité et appareils",
    description: "Accès, sessions, appareils et récupération",
    icon: "lock",
    group: "personal",
  },
  {
    id: "backups",
    label: "Sauvegardes",
    description: "Copies complètes, protection distante et essais de restauration",
    icon: "archive",
    group: "installation",
  },
  {
    id: "local-data",
    label: "Stockage et synchronisation",
    description: "Données de cet appareil et changements en attente",
    icon: "sync",
    group: "data",
  },
  {
    id: "trash",
    label: "Corbeille",
    description: "Éléments supprimés encore récupérables",
    icon: "delete",
    group: "data",
  },
  {
    id: "page-details",
    label: "Page actuelle",
    description: "Identité, relations et historique technique",
    icon: "info",
    group: "data",
  },
] as const;

export interface SettingsShellProps {
  readonly activeSection: SettingsSection;
  readonly children: ReactNode;
  readonly onBack: () => void;
  readonly onSectionChange: (section: SettingsSection) => void;
  /** Members never see administrator-only sections (feature 058). */
  readonly administrator?: boolean;
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
  administrator = false,
}: SettingsShellProps) {
  const visibleSections = SETTINGS_SECTIONS.filter(
    (section) => administrator || !ADMINISTRATOR_SECTIONS.has(section.id),
  );
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
            size="compact"
            variant="ghost"
            data-testid="back-to-workspace"
            onClick={onBack}
          >
            <AppIcon name="arrowLeft" size="small" />
            Espace de travail
          </Button>
          <p className="settings-sidebar__title">Réglages</p>
        </header>

        <nav className="settings-navigation" aria-label="Sections des réglages">
          {SETTINGS_GROUPS.map((group) => {
            const sections = visibleSections.filter((section) => section.group === group.id);
            if (sections.length === 0) return null;
            return (
              <section
                key={group.id}
                className="settings-navigation__group"
                aria-labelledby={`settings-group-${group.id}`}
              >
                <p className="settings-navigation__group-label" id={`settings-group-${group.id}`}>
                  {group.label}
                </p>
                {sections.map((section) => (
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
                      <span className="settings-navigation__label">{section.label}</span>
                      <small className="settings-navigation__hint">{section.description}</small>
                    </span>
                  </Button>
                ))}
              </section>
            );
          })}
        </nav>
      </aside>

      <main id="settings-main" className="settings-main" tabIndex={-1}>
        <header className="settings-main__header">
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
        <div
          className="settings-content"
          data-section={activeSection}
          data-testid={`settings-section-${activeSection}`}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
