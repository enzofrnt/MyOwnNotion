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
  createLucideIcon,
  Download,
  Ellipsis,
  File,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
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
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
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
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { forwardRef } from "react";
import { classNames } from "./class-names.ts";

/**
 * Knowledge-graph mark in Lucide metrics (24×24, round stroke). Satellites sit
 * near the canvas edges without a corner node pulling the optical centre off
 * the 24×24 square; neighbour edges stay on the hub rather than a top chord.
 */
const KnowledgeGraph = createLucideIcon("knowledge-graph", [
  ["line", { x1: "10.54", y1: "9.92", x2: "6.25", y2: "5.5", key: "hub-nw" }],
  ["line", { x1: "14.17", y1: "12.16", x2: "18.73", y2: "13.58", key: "hub-e" }],
  ["line", { x1: "10.82", y1: "13.31", x2: "7.36", y2: "18.35", key: "hub-sw" }],
  ["line", { x1: "9.87", y1: "11.58", x2: "4.82", y2: "11.76", key: "hub-w" }],
  ["line", { x1: "13.6", y1: "9.92", x2: "17.08", y2: "6.33", key: "hub-ne" }],
  ["line", { x1: "18.17", y1: "6.61", x2: "19.72", y2: "12.64", key: "ne-e" }],
  ["circle", { cx: "12.07", cy: "11.5", r: "2.2", key: "hub" }],
  ["circle", { cx: "5.27", cy: "4.5", r: "1.4", key: "nw" }],
  ["circle", { cx: "17.88", cy: "5.5", r: "1.15", key: "ne" }],
  ["circle", { cx: "20.07", cy: "14", r: "1.4", key: "e" }],
  ["circle", { cx: "6.57", cy: "19.5", r: "1.4", key: "sw" }],
  ["circle", { cx: "3.67", cy: "11.8", r: "1.15", key: "w" }],
]);

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
  fileAdd: FilePlus,
  fileText: FileText,
  folder: Folder,
  folderAdd: FolderPlus,
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
  graph: KnowledgeGraph,
  offline: CloudOff,
  panel: PanelLeft,
  panelClose: PanelLeftClose,
  panelOpen: PanelLeftOpen,
  paperclip: Paperclip,
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
  zoomIn: ZoomIn,
  zoomOut: ZoomOut,
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
  fileAdd: "Ajouter une page",
  fileText: "Document",
  folder: "Dossier",
  folderAdd: "Ajouter un dossier",
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
  graph: "Graphe",
  offline: "Hors ligne",
  panel: "Panneau latéral",
  panelClose: "Masquer le panneau latéral",
  panelOpen: "Afficher le panneau latéral",
  paperclip: "Pièces jointes",
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
  zoomIn: "Zoomer",
  zoomOut: "Dézoomer",
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
      className={classNames(
        "ui-icon",
        name === "loading" && "ui-icon--spinning",
        name === "graph" && "ui-icon--graph",
        className,
      )}
      data-icon={name}
      size={APP_ICON_SIZES[size]}
      focusable="false"
      aria-hidden={accessibleLabel === undefined ? true : undefined}
      aria-label={accessibleLabel}
      role={accessibleLabel === undefined ? undefined : "img"}
    />
  );
});
