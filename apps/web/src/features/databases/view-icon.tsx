import type { DatabaseViewType } from "@myownnotion/domain";
import {
  Activity,
  AlarmClock,
  Anchor,
  Apple,
  Archive,
  Award,
  Backpack,
  Bell,
  BellOff,
  Bike,
  Binoculars,
  Bluetooth,
  Bomb,
  Bone,
  Book,
  Bookmark,
  Box,
  Briefcase,
  Bug,
  Cake,
  Camera,
  Car,
  Cat,
  Cloud,
  Coffee,
  Compass,
  Crown,
  Diamond,
  Dog,
  Drum,
  Eye,
  Flag,
  Flame,
  Flower2,
  Gamepad2,
  Gift,
  Glasses,
  Globe,
  Guitar,
  Hammer,
  Heart,
  Home,
  Hourglass,
  Key,
  Lamp,
  Leaf,
  Lightbulb,
  type LucideIcon,
  Magnet,
  Map as MapIcon,
  Medal,
  Moon,
  Mountain,
  Music,
  Palette,
  PawPrint,
  Phone,
  Pin,
  Plane,
  Rocket,
  Ship,
  Shirt,
  Smile,
  Star,
  Sun,
  Sword,
  Tent,
  TreePine,
  Trophy,
  Umbrella,
  Utensils,
  Watch,
  Zap,
} from "lucide-react";
import { AppIcon, type AppIconSize } from "../../ui/icons.tsx";
import { VIEW_TYPE_ICON } from "./view-tab-names.ts";

export interface ViewIconChoice {
  readonly id: string;
  readonly label: string;
  readonly Icon: LucideIcon;
}

const CHOICES: readonly ViewIconChoice[] = [
  { id: "activity", label: "activité", Icon: Activity },
  { id: "alarm-clock", label: "réveil", Icon: AlarmClock },
  { id: "anchor", label: "ancre", Icon: Anchor },
  { id: "apple", label: "pomme", Icon: Apple },
  { id: "archive", label: "archive", Icon: Archive },
  { id: "award", label: "récompense", Icon: Award },
  { id: "backpack", label: "sac", Icon: Backpack },
  { id: "bell", label: "cloche", Icon: Bell },
  { id: "bell-off", label: "cloche barrée", Icon: BellOff },
  { id: "bike", label: "vélo", Icon: Bike },
  { id: "binoculars", label: "jumelles", Icon: Binoculars },
  { id: "bluetooth", label: "bluetooth", Icon: Bluetooth },
  { id: "bomb", label: "bombe", Icon: Bomb },
  { id: "bone", label: "os", Icon: Bone },
  { id: "book", label: "livre", Icon: Book },
  { id: "bookmark", label: "signet", Icon: Bookmark },
  { id: "box", label: "boîte", Icon: Box },
  { id: "briefcase", label: "mallette", Icon: Briefcase },
  { id: "bug", label: "insecte", Icon: Bug },
  { id: "cake", label: "gâteau", Icon: Cake },
  { id: "camera", label: "appareil photo", Icon: Camera },
  { id: "car", label: "voiture", Icon: Car },
  { id: "cat", label: "chat", Icon: Cat },
  { id: "cloud", label: "nuage", Icon: Cloud },
  { id: "coffee", label: "café", Icon: Coffee },
  { id: "compass", label: "boussole", Icon: Compass },
  { id: "crown", label: "couronne", Icon: Crown },
  { id: "diamond", label: "diamant", Icon: Diamond },
  { id: "dog", label: "chien", Icon: Dog },
  { id: "drum", label: "tambour", Icon: Drum },
  { id: "eye", label: "œil", Icon: Eye },
  { id: "flag", label: "drapeau", Icon: Flag },
  { id: "flame", label: "flamme", Icon: Flame },
  { id: "flower", label: "fleur", Icon: Flower2 },
  { id: "gamepad", label: "manette", Icon: Gamepad2 },
  { id: "gift", label: "cadeau", Icon: Gift },
  { id: "glasses", label: "lunettes", Icon: Glasses },
  { id: "globe", label: "globe", Icon: Globe },
  { id: "guitar", label: "guitare", Icon: Guitar },
  { id: "hammer", label: "marteau", Icon: Hammer },
  { id: "heart", label: "cœur", Icon: Heart },
  { id: "home", label: "maison", Icon: Home },
  { id: "hourglass", label: "sablier", Icon: Hourglass },
  { id: "key", label: "clé", Icon: Key },
  { id: "lamp", label: "lampe", Icon: Lamp },
  { id: "leaf", label: "feuille", Icon: Leaf },
  { id: "lightbulb", label: "ampoule", Icon: Lightbulb },
  { id: "magnet", label: "aimant", Icon: Magnet },
  { id: "map", label: "carte", Icon: MapIcon },
  { id: "medal", label: "médaille", Icon: Medal },
  { id: "moon", label: "lune", Icon: Moon },
  { id: "mountain", label: "montagne", Icon: Mountain },
  { id: "music", label: "musique", Icon: Music },
  { id: "palette", label: "palette", Icon: Palette },
  { id: "paw", label: "patte", Icon: PawPrint },
  { id: "phone", label: "téléphone", Icon: Phone },
  { id: "pin", label: "épingle", Icon: Pin },
  { id: "plane", label: "avion", Icon: Plane },
  { id: "rocket", label: "fusée", Icon: Rocket },
  { id: "ship", label: "bateau", Icon: Ship },
  { id: "shirt", label: "chemise", Icon: Shirt },
  { id: "smile", label: "sourire", Icon: Smile },
  { id: "star", label: "étoile", Icon: Star },
  { id: "sun", label: "soleil", Icon: Sun },
  { id: "sword", label: "épée", Icon: Sword },
  { id: "tent", label: "tente", Icon: Tent },
  { id: "tree", label: "arbre", Icon: TreePine },
  { id: "trophy", label: "trophée", Icon: Trophy },
  { id: "umbrella", label: "parapluie", Icon: Umbrella },
  { id: "utensils", label: "couverts", Icon: Utensils },
  { id: "watch", label: "montre", Icon: Watch },
  { id: "zap", label: "éclair", Icon: Zap },
];

const BY_ID = new Map(CHOICES.map((choice) => [choice.id, choice]));

export const VIEW_ICON_CHOICES = CHOICES;

export function viewIconChoice(id: string | null | undefined): ViewIconChoice | null {
  if (id == null || id === "") return null;
  return BY_ID.get(id) ?? null;
}

const MARK_SIZE: Readonly<Record<AppIconSize, number>> = {
  small: 14,
  medium: 18,
  large: 22,
};

export function ViewMark({
  icon,
  type,
  size = "small",
}: {
  readonly icon?: string | null | undefined;
  readonly type: DatabaseViewType;
  readonly size?: AppIconSize;
}) {
  const choice = viewIconChoice(icon);
  if (choice === null) return <AppIcon name={VIEW_TYPE_ICON[type]} size={size} />;
  const Icon = choice.Icon;
  return (
    <Icon
      className="ui-icon"
      size={MARK_SIZE[size]}
      focusable="false"
      aria-hidden="true"
      data-icon={choice.id}
    />
  );
}
