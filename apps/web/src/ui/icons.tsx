import {
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Bold,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Cloud,
  CloudOff,
  Code2,
  Copy,
  Download,
  Ellipsis,
  File,
  FileText,
  Folder,
  GripVertical,
  Heading1,
  Heading2,
  Heading3,
  Image,
  Info,
  Italic,
  Link,
  List,
  ListChecks,
  LoaderCircle,
  LockKeyhole,
  type LucideIcon,
  type LucideProps,
  Menu,
  Minus,
  Monitor,
  Moon,
  PanelLeft,
  Plus,
  Quote,
  Redo2,
  Search,
  Settings,
  Smile,
  Sun,
  Table2,
  Trash2,
  Underline,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { forwardRef } from "react";
import { classNames } from "./class-names.ts";

export const APP_ICONS = {
  add: Plus,
  archive: Archive,
  arrowDown: ArrowDown,
  arrowLeft: ArrowLeft,
  arrowRight: ArrowRight,
  reference: ArrowUpRight,
  arrowUp: ArrowUp,
  bold: Bold,
  calendar: CalendarDays,
  check: Check,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  close: X,
  code: Code2,
  conflict: CircleAlert,
  copy: Copy,
  delete: Trash2,
  download: Download,
  drag: GripVertical,
  file: File,
  fileText: FileText,
  folder: Folder,
  heading1: Heading1,
  heading2: Heading2,
  heading3: Heading3,
  help: CircleHelp,
  image: Image,
  info: Info,
  italic: Italic,
  link: Link,
  list: List,
  loading: LoaderCircle,
  lock: LockKeyhole,
  menu: Menu,
  more: Ellipsis,
  offline: CloudOff,
  panel: PanelLeft,
  quote: Quote,
  redo: Redo2,
  remove: Minus,
  search: Search,
  settings: Settings,
  smile: Smile,
  success: CircleCheck,
  sync: Cloud,
  table: Table2,
  taskList: ListChecks,
  themeDark: Moon,
  themeLight: Sun,
  themeSystem: Monitor,
  underline: Underline,
  undo: Undo2,
  upload: Upload,
} as const satisfies Readonly<Record<string, LucideIcon>>;

export type AppIconName = keyof typeof APP_ICONS;
export type AppIconSize = "small" | "medium" | "large";

export const APP_ICON_SIZES: Readonly<Record<AppIconSize, number>> = {
  small: 14,
  medium: 18,
  large: 22,
};

export const APP_ICON_LABELS: Readonly<Record<AppIconName, string>> = {
  add: "Ajouter",
  archive: "Archiver",
  arrowDown: "Vers le bas",
  arrowLeft: "Vers la gauche",
  arrowRight: "Vers la droite",
  reference: "Référence",
  arrowUp: "Vers le haut",
  bold: "Gras",
  calendar: "Calendrier",
  check: "Validé",
  chevronDown: "Chevron vers le bas",
  chevronRight: "Chevron vers la droite",
  close: "Fermer",
  code: "Code",
  conflict: "Conflit",
  copy: "Copier",
  delete: "Supprimer",
  download: "Télécharger",
  drag: "Déplacer",
  file: "Fichier",
  fileText: "Document",
  folder: "Dossier",
  heading1: "Titre 1",
  heading2: "Titre 2",
  heading3: "Titre 3",
  help: "Aide",
  image: "Image",
  info: "Information",
  italic: "Italique",
  link: "Lien",
  list: "Liste",
  loading: "Chargement",
  lock: "Verrouillé",
  menu: "Menu",
  more: "Plus d’actions",
  offline: "Hors ligne",
  panel: "Panneau latéral",
  quote: "Citation",
  redo: "Rétablir",
  remove: "Retirer",
  search: "Rechercher",
  settings: "Réglages",
  smile: "Emoji",
  success: "Réussi",
  sync: "Synchronisation",
  table: "Tableau",
  taskList: "Liste de tâches",
  themeDark: "Thème sombre",
  themeLight: "Thème clair",
  themeSystem: "Thème système",
  underline: "Souligné",
  undo: "Annuler",
  upload: "Importer",
};

export interface AppIconProps extends Omit<LucideProps, "aria-label" | "size"> {
  readonly name: AppIconName;
  readonly size?: AppIconSize;
  /** `true` uses the centralized French name; omit for a decorative icon. */
  readonly label?: true | string;
}

export const AppIcon = forwardRef<SVGSVGElement, AppIconProps>(function AppIcon(
  { className, label, name, size = "medium", ...props },
  ref,
) {
  const Icon = APP_ICONS[name];
  const accessibleLabel = label === true ? APP_ICON_LABELS[name] : label;
  return (
    <Icon
      {...props}
      ref={ref}
      className={classNames("ui-icon", name === "loading" && "ui-icon--spinning", className)}
      data-icon={name}
      size={APP_ICON_SIZES[size]}
      focusable="false"
      aria-hidden={accessibleLabel === undefined ? true : undefined}
      aria-label={accessibleLabel}
      role={accessibleLabel === undefined ? undefined : "img"}
    />
  );
});
