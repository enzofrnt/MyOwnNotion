export const UI_LOCALE = "fr-FR";

export const FR_COPY = {
  appName: "MyOwnNotion",
  actions: {
    add: "Ajouter",
    cancel: "Annuler",
    close: "Fermer",
    confirm: "Confirmer",
    continue: "Continuer",
    delete: "Supprimer",
    edit: "Modifier",
    more: "Plus d’actions",
    retry: "Réessayer",
    save: "Enregistrer",
    search: "Rechercher",
  },
  theme: {
    label: "Thème",
    system: "Système",
    light: "Clair",
    dark: "Sombre",
  },
  status: {
    loading: "Chargement…",
    empty: "Aucun contenu",
    unavailable: "Indisponible sur cet appareil",
    offline: "Hors ligne",
    error: "Une erreur est survenue",
    success: "Terminé",
    conflict: "Une décision est nécessaire",
    pending: "Enregistré sur cet appareil",
    syncing: "Synchronisation…",
    info: "Information",
  },
  field: {
    optional: "facultatif",
    required: "obligatoire",
  },
  date: {
    invalid: "Date invalide",
  },
} as const;

export type ShortcutPlatform = "mac" | "windows" | "linux";
export type ShortcutKey =
  | "mod"
  | "shift"
  | "alt"
  | "enter"
  | "escape"
  | "space"
  | "arrowUp"
  | "arrowDown"
  | "arrowLeft"
  | "arrowRight"
  | string;

export const APP_SHORTCUTS = {
  search: ["mod", "k"],
  close: ["escape"],
  submit: ["mod", "enter"],
  commandMenu: ["/"],
} as const satisfies Record<string, readonly ShortcutKey[]>;

const MAC_KEYS: Readonly<Record<string, string>> = {
  mod: "⌘",
  shift: "⇧",
  alt: "⌥",
  enter: "↵",
  escape: "Échap",
  space: "Espace",
  arrowUp: "↑",
  arrowDown: "↓",
  arrowLeft: "←",
  arrowRight: "→",
};

const OTHER_KEYS: Readonly<Record<string, string>> = {
  mod: "Ctrl",
  shift: "Maj",
  alt: "Alt",
  enter: "Entrée",
  escape: "Échap",
  space: "Espace",
  arrowUp: "↑",
  arrowDown: "↓",
  arrowLeft: "←",
  arrowRight: "→",
};

function displayShortcutKey(key: ShortcutKey, platform: ShortcutPlatform): string {
  const labels = platform === "mac" ? MAC_KEYS : OTHER_KEYS;
  return labels[key] ?? key.toLocaleUpperCase(UI_LOCALE);
}

export function formatShortcut(keys: readonly ShortcutKey[], platform: ShortcutPlatform): string {
  const separator = platform === "mac" ? " " : " + ";
  return keys.map((key) => displayShortcutKey(key, platform)).join(separator);
}

export function formatNumber(value: number | bigint, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(UI_LOCALE, options).format(value);
}

export type DateInput = Date | number | string;

function asDate(value: DateInput): Date {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    if (year !== undefined && month !== undefined && day !== undefined) {
      return new Date(year, month - 1, day);
    }
  }
  return value instanceof Date ? value : new Date(value);
}

export function formatDate(
  value: DateInput,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
): string {
  const date = asDate(value);
  if (Number.isNaN(date.getTime())) {
    return FR_COPY.date.invalid;
  }
  return new Intl.DateTimeFormat(UI_LOCALE, options).format(date);
}

export function formatDateTime(
  value: DateInput,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
): string {
  return formatDate(value, options);
}
