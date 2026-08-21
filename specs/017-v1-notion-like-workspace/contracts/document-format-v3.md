# Contract: Document canonique v3

## 1. Rôle et enveloppe

Le format canonique reste la représentation durable, lisible et indépendante
de l'éditeur utilisée par la recherche, les liens, les exports, les révisions et
les sauvegardes. Il est une projection de l'état opérationnel convergent ; il
n'est plus le chemin d'écriture ordinaire d'une page active.

~~~ts
interface PageDocumentEnvelopeV3 {
  format: "myownnotion.document+json";
  formatVersion: 3;
  body: {
    blocks: CanonicalBlockV3[];
  };
}
~~~

Les clés `format`, `formatVersion` et `body` restent identiques à la v2. Une
page v3 ouverte par un client v2 est lisible via la projection serveur, mais
son écriture est refusée avant parsing afin que les nouveaux blocs ou marques
ne puissent pas être réduits.

## 2. Identités, ordre et hiérarchie

- Chaque bloc, ligne de table et cellule possède un UUID stable.
- Un même UUID ne peut désigner qu'un seul nœud vivant dans une page.
- L'ordre des tableaux `blocks`, `children`, `rows` et `cells` est canonique.
- Les blocs pouvant contenir des enfants portent `children` uniquement quand
  la liste n'est pas vide.
- Déplacer ou convertir un bloc conserve son UUID.
- La projection ne contient aucune position CRDT, peer ID, tombstone, version
  vector ni métadonnée d'éditeur.

## 3. Texte riche

~~~ts
interface InlineV3 {
  text: string;
  marks?: MarkV3[];
}

type KnownMarkV3 =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "underline" }
  | { type: "strikethrough" }
  | { type: "code" }
  | { type: "link"; href: string }
  | { type: "pageLink"; targetItemId: Uuid }
  | { type: "textColor"; color: ColorToken }
  | { type: "backgroundColor"; color: ColorToken };

type ColorToken =
  | "default" | "gray" | "brown" | "orange" | "yellow"
  | "green" | "blue" | "purple" | "pink" | "red";
~~~

Les couleurs sont des tokens sémantiques, pas des valeurs CSS arbitraires. Le
thème décide de leur rendu et maintient les contrastes requis.

Les liens externes n'acceptent que `http:`, `https:` et `mailto:`. Un lien de
page porte l'UUID logique, jamais une URL de navigation. `code` est exclusif :
si une entrée contient `code` et d'autres marques connues, la validation
échoue au lieu de choisir silencieusement.

Une marque inconnue est conservée comme objet JSON opaque lors du parsing et
réémise sans suppression de clés. Elle n'est pas appliquée visuellement par un
client qui ne la comprend pas. Les marques connues dupliquées ou incompatibles
sont invalides à l'entrée persistée ; les commandes éditeur normalisent avant
projection.

Ordre canonique des marques connues :

~~~text
bold, italic, underline, strikethrough, code, link, pageLink,
textColor, backgroundColor
~~~

Les marques inconnues restent après les marques connues, triées par leur JSON
canonique pour obtenir un digest déterministe sans modifier leur objet. Deux
runs adjacents portant exactement les mêmes marques sont fusionnés. Les runs de
texte vides sont supprimés, sauf le run vide temporaire de l'état opérationnel
qui n'est jamais projeté.

Politique de frappe aux bornes :

- `bold`, `italic`, `underline`, `strikethrough`, `textColor` et
  `backgroundColor` s'étendent au texte saisi immédiatement à leur borne ;
- `link`, `pageLink` et `code` ne s'étendent pas après leur borne droite ;
- la même politique est utilisée dans BlockNote, Loro, la projection et les
  tests de propriétés.

## 4. Blocs textuels et structurels

Les noms v2 sont conservés (`checkbox`, `code`) même lorsque l'éditeur utilise
un nom interne différent.

~~~ts
type CanonicalBlockV3 =
  | { type: "paragraph"; id: Uuid; content: InlineV3[] }
  | { type: "heading"; id: Uuid; level: 1 | 2 | 3; content: InlineV3[] }
  | {
      type: "bulletedListItem";
      id: Uuid;
      content: InlineV3[];
      children?: CanonicalBlockV3[];
    }
  | {
      type: "numberedListItem";
      id: Uuid;
      content: InlineV3[];
      children?: CanonicalBlockV3[];
    }
  | {
      type: "checkbox";
      id: Uuid;
      checked: boolean;
      content: InlineV3[];
      children?: CanonicalBlockV3[];
    }
  | {
      type: "quote";
      id: Uuid;
      content: InlineV3[];
      children?: CanonicalBlockV3[];
    }
  | { type: "code"; id: Uuid; text: string; language: string | null }
  | { type: "divider"; id: Uuid }
  | {
      type: "toggle";
      id: Uuid;
      content: InlineV3[];
      children?: CanonicalBlockV3[];
    }
  | {
      type: "callout";
      id: Uuid;
      content: InlineV3[];
      icon: string | null;
      tone: ColorToken;
      children?: CanonicalBlockV3[];
    }
  | TableBlockV3
  | ImageBlockV3
  | FileEmbedBlockV3
  | EmbedBlockV3
  | UnknownBlockV3;
~~~

`icon` contient au plus un grapheme emoji ou `null` en V1. Il ne contient ni
HTML ni URL. `language` utilise une valeur texte bornée et non exécutable ; le
code n'est jamais évalué par l'application.

## 5. Tables

~~~ts
interface TableBlockV3 {
  type: "table";
  id: Uuid;
  columns: Array<{
    id: Uuid;
    width: number | null;
  }>;
  rows: Array<{
    id: Uuid;
    cells: Array<{
      id: Uuid;
      content: InlineV3[];
      children?: CanonicalBlockV3[];
    }>;
  }>;
}
~~~

Une table comporte de 1 à 50 colonnes et de 1 à 10 000 lignes. Chaque ligne a
exactement une cellule par colonne et conserve l'ordre des colonnes. `width`
est `null` ou un nombre entier entre 80 et 1 200 pixels logiques ; le responsive
peut ignorer cette largeur sans la réécrire. Les fusions de cellules, formules
et tables imbriquées sont hors V1.

Le modèle opérationnel représente lignes et cellules comme nœuds stables afin
que deux appareils modifiant deux cellules distinctes convergent sans conflit.
La projection compacte ces nœuds dans la forme ci-dessus.

## 6. Images, fichiers et embeds

~~~ts
interface ImageBlockV3 {
  type: "image";
  id: Uuid;
  fileItemId: Uuid;
  caption: string | null;
  altText: string | null;
  displayWidth: number | null;
}

interface FileEmbedBlockV3 {
  type: "fileEmbed";
  id: Uuid;
  fileItemId: Uuid;
  caption: string | null;
}

interface EmbedBlockV3 {
  type: "embed";
  id: Uuid;
  provider: "bookmark" | "youtube" | "vimeo" | "figma" | "github" | "drawio";
  sourceUrl: string;
  caption: string | null;
}
~~~

Une image et un fichier référencent l'item logique de la feature 005. Le nom,
le type MIME, la taille, le digest et les octets ne sont pas recopiés dans le
document. `displayWidth` est `null` ou un entier de 80 à 2 400 pixels logiques.

`embed.sourceUrl` doit être HTTPS et correspondre à l'allowlist du fournisseur.
Le rendu distant est opt-in, sandboxé et ne rend jamais du HTML stocké dans le
document. Sans consentement ou hors ligne, le bloc reste un lien statique. Les
tokens, paramètres secrets et HTML de fournisseur sont interdits.

## 7. Contenu inconnu

Un bloc dont `type` n'est pas connu est chargé sous une représentation mémoire
`unknown`, mais son objet JSON brut est l'autorité de réémission. S'il possède
un UUID valide, celui-ci sert à la stabilité et au placement. Sinon, le client
peut lui attribuer un ID synthétique uniquement en mémoire ; il ne modifie pas
l'objet brut lors d'une simple ouverture.

Le modèle opérationnel conserve l'objet brut dans `rawUnknown`. Une commande
qui ne comprend pas ce bloc peut le déplacer ou le supprimer explicitement,
mais ne peut ni convertir son contenu, ni le normaliser, ni écrire dans ses
champs. Une mise à jour distante d'un raw inconnu et une modification locale
qui le réduirait ouvrent une ambiguïté `schema`.

Les propriétés inconnues d'un bloc connu sont également conservées dans une
zone opaque lors de la migration v3. Sur le wire, elles restent aux mêmes clés
de premier niveau ; en mémoire, `rawExtraProperties` les sépare des champs
connus afin qu'une normalisation ne les parcoure pas. La sérialisation écrit
d'abord les champs connus dans leur ordre contractuel, puis les clés opaques en
ordre Unicode. Une clé opaque qui entre en collision avec un champ connu est
une erreur de schéma et non une victoire silencieuse. Ces propriétés ne
deviennent pas des propriétés éditeur actives avant qu'un schéma les
reconnaisse.

## 8. Limites et validation

- 500 blocs est la cible interactive, pas une limite destructive.
- La profondeur maximale acceptée est 32.
- Une page projetée ne dépasse pas 16 MiB de JSON UTF-8.
- Un run inline ne dépasse pas 1 MiB et une URL 2 048 caractères.
- Les chaînes sont Unicode valides ; aucun contrôle C0 n'est accepté hors
  tabulation et nouvelle ligne dans un bloc code.
- UUID, références de fichier et liens de page sont validés avant indexation.
- Aucun champ texte n'est interprété comme HTML.
- Une violation d'un type connu bloque la projection et conserve l'état
  opérationnel ; elle n'est jamais corrigée par perte de données.

Le JSON canonique utilise UTF-8, sans BOM, clés dans l'ordre défini par les
types, nombres décimaux minimaux et aucune clé à valeur `undefined`. Son digest
est SHA-256 des octets canoniques complets de l'enveloppe.

## 9. Migration v2 vers v3

La lecture d'une page v2 n'écrit rien. À l'activation :

1. valider et normaliser la v2 avec son validateur historique ;
2. conserver tous les UUID, textes, marques, enfants et objets inconnus ;
3. convertir chaque bloc v2 vers son type v3 de même nom ;
4. traiter explicitement `fileEmbed` et vérifier que son aller-retour conserve
   `fileItemId` et `caption` ;
5. créer l'état opérationnel avec des identités internes serveur ;
6. projeter immédiatement en v3 ;
7. vérifier que la projection v3, réduite aux champs v2, est équivalente ;
8. commit atomique de l'état actif et de la projection.

Une branche v2 modifiée hors ligne suit le contrat de migration sémantique de
`crdt-sync.md`; elle ne crée jamais son propre « genesis » opérationnel à
fusionner aveuglément.

## 10. Round-trip et critères contractuels

- v2 connu → migration → v3 → import/export éditeur → v3 identique ;
- bloc `fileEmbed` → éditeur → projection conserve référence et caption ;
- bloc ou marque inconnu → ouverture et modification d'un voisin → raw
  inconnu conservé ;
- deux états opérationnels équivalents → mêmes octets v3 et même digest ;
- table avec cellules modifiées sur deux appareils → toutes les cellules
  présentes dans la projection convergée ;
- lien dangereux ou embed non autorisé → projection bloquée, jamais rendu ;
- client v2 tentant d'écrire une page v3 → lecture seule avant réduction.
