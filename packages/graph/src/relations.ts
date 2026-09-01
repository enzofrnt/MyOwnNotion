import { isValidRelationType } from "@myownnotion/domain";

const RELATION_PRESENTATIONS = {
  "database:property": "Propriété reliée",
  "file:attachment": "Pièce jointe",
  "hierarchy:contains": "Contient",
  "page:link": "Lien interne",
} as const satisfies Readonly<Record<string, string>>;

export interface RelationTypePresentation {
  readonly type: string;
  readonly known: boolean;
  readonly label: string;
}

export function isGraphRelationType(value: string): boolean {
  return isValidRelationType(value);
}

export function describeRelationType(type: string): RelationTypePresentation {
  const label = RELATION_PRESENTATIONS[type as keyof typeof RELATION_PRESENTATIONS];
  return label === undefined
    ? { type, known: false, label: "Relation non reconnue" }
    : { type, known: true, label };
}
