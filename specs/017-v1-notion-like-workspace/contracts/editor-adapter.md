# Contract: Adaptateur éditeur ↔ état de page

## 1. Frontière

BlockNote est une vue et un moteur d'interaction. Il n'est ni la source de
vérité, ni le format de stockage, ni le moteur de synchronisation.

~~~text
Gestes utilisateur
      │
      ▼
BlockNote Community (vue locale)
      │ getChanges() + IDs
      ▼
EditorAdapter
      │ commandes MyOwnNotion
      ▼
PageSession / état Loro
      │ update + projection
      ▼
Transaction Dexie chiffrée
      │
      ├── statut local durable
      ├── BroadcastChannel
      └── outbox HTTP
~~~

L'adaptateur n'importe jamais Dexie, Fastify, Drizzle ou les contrats HTTP. Il
reçoit une `PageSession` et publie des événements métiers. Réciproquement,
`packages/page-state` n'importe jamais React, BlockNote ou le DOM.

Le mode collaboration Yjs de BlockNote et tout provider de persistance
BlockNote restent désactivés.

## 2. Interface produit

Les noms exacts peuvent évoluer pendant l'implémentation, mais la séparation
suivante est contractuelle :

~~~ts
interface PageEditorAdapter {
  mount(session: PageEditingSession, host: HTMLElement): MountedPageEditor;
}

interface PageEditingSession {
  pageId: Uuid;
  read(): VisiblePageSnapshot;
  transact(command: PageCommand): Promise<LocalCommitResult>;
  subscribe(listener: (change: PageSessionChange) => void): Unsubscribe;
  captureRelativePosition(blockId: Uuid, utf16Offset: number): StablePosition;
  resolveRelativePosition(position: StablePosition): ResolvedPosition | null;
}

interface MountedPageEditor {
  focus(target?: { blockId: Uuid; placement: "start" | "end" }): void;
  captureViewState(): EditorViewState;
  restoreViewState(state: EditorViewState): void;
  setReadOnly(reason: ReadOnlyReason | null): void;
  destroy(): void;
}
~~~

Une commande acceptée ne signifie « enregistré sur cet appareil » qu'après le
commit chiffré de `LocalCommitResult`. Une erreur de quota, de clé, de schéma ou
de transaction maintient le texte encore visible dans un buffer de secours,
bloque les nouvelles commandes destructives et propose une copie/récupération.

## 3. Schéma et correspondance des blocs

| Canonique MyOwnNotion | Bloc BlockNote visible | Identité |
| --- | --- | --- |
| `paragraph` | paragraph | même UUID |
| `heading` 1–3 | heading | même UUID |
| `bulletedListItem` | bullet list item | même UUID |
| `numberedListItem` | numbered list item | même UUID |
| `checkbox` | check list item | même UUID |
| `quote` | quote | même UUID |
| `code` | code block customisé | même UUID |
| `divider` | divider | même UUID |
| `toggle` | toggle customisé | même UUID |
| `callout` | alert/callout customisé | même UUID |
| `table` | table avec lignes/cellules stables | IDs table/ligne/cellule conservés |
| `image` | image customisée liée à feature 005 | même UUID |
| `fileEmbed` | fichier customisé lié à feature 005 | même UUID |
| `embed` | embed statique/sandboxé | même UUID |
| inconnu | placeholder non destructif | UUID connu ou synthétique non persisté |

L'adaptateur fournit explicitement les IDs lors de l'hydratation. Il refuse une
réponse de BlockNote qui dupliquerait, remplacerait ou détacherait un ID sans
commande correspondante.

Les blocs inconnus affichent type déclaré, présence de contenu non pris en
charge et actions sûres : déplacer, copier le JSON pour récupération ou
supprimer avec confirmation. Ils ne deviennent jamais un paragraphe vide.

## 4. Commandes minimales

~~~ts
type PageCommand =
  | { type: "insert-block"; block: NewCanonicalBlock; parentId: Uuid | null; beforeId: Uuid | null }
  | { type: "move-block"; blockId: Uuid; parentId: Uuid | null; beforeId: Uuid | null }
  | { type: "delete-block"; blockId: Uuid }
  | { type: "replace-text"; blockId: Uuid; from: number; to: number; text: string }
  | { type: "format-text"; blockId: Uuid; from: number; to: number; mark: MarkV3; enabled: boolean }
  | { type: "set-block-type"; blockId: Uuid; blockType: CanonicalBlockType; props: JsonObject }
  | { type: "set-block-property"; blockId: Uuid; key: string; value: JsonValue }
  | { type: "insert-table-row" | "delete-table-row"; tableId: Uuid; rowId: Uuid; beforeRowId?: Uuid }
  | { type: "insert-table-column" | "delete-table-column"; tableId: Uuid; columnId: Uuid; beforeColumnId?: Uuid };
~~~

La traduction d'un événement local suit ces règles :

1. utiliser `getChanges()` et les IDs BlockNote pour identifier insert, delete,
   update et move ;
2. calculer un diff textuel/marks borné uniquement dans les blocs annoncés
   `update` ;
3. convertir un move en `move-block`, jamais en delete puis insert ;
4. grouper les effets d'un geste dans une transaction atomique ;
5. valider les invariants avant de modifier l'état opérationnel ;
6. ne faire un diff de document complet qu'en diagnostic, migration ou
   réparation explicite.

Une saisie IME/composition est une transaction cohérente ; elle n'est pas
découpée en commandes invalides à chaque événement DOM. Coller plusieurs blocs
ou un tableau reste un lot atomique dont chaque nouveau bloc reçoit son UUID
avant commit.

## 5. Application des changements distants

`PageSessionChange` contient les identités et champs touchés après import et
persistance d'une update distante. L'adaptateur applique la modification la
plus ciblée disponible :

- insertion/suppression/move par UUID ;
- mise à jour du texte et des styles d'un seul bloc ;
- mise à jour de propriété ;
- reconstruction du seul sous-arbre dont le schéma a changé.

Pendant cette application, l'origine est `remote` ou `recovery`; le callback de
changement local est suspendu. L'application ne génère donc aucune update en
écho. Une reconstruction complète est autorisée uniquement si les commandes
ciblées ne peuvent reproduire la projection, et déclenche un compteur de
diagnostic sans contenu.

Après chaque lot distant :

1. comparer les IDs et la structure BlockNote à la projection visible ;
2. vérifier que le bloc actif existe encore ;
3. restaurer la sélection par position relative stable ;
4. replier vers le bloc voisin logique si la position a été supprimée ;
5. conserver le scroll par ancre de bloc plutôt que par pixel seulement.

## 6. Sélection, présence locale et onglets

La sélection persistable est :

~~~ts
interface EditorViewState {
  anchor: StablePosition | null;
  head: StablePosition | null;
  activeBlockId: Uuid | null;
  scrollAnchor: { blockId: Uuid; offset: number } | null;
}
~~~

Les positions stables viennent du modèle opérationnel et sont converties vers
les offsets BlockNote au dernier moment. Elles ne sont pas synchronisées entre
appareils comme du contenu. La présence temps réel multi-utilisateur est hors
V1.

Chaque onglet a son propre Peer ID et sa propre session. `BroadcastChannel`
transporte uniquement une annonce et, lorsque la taille le permet, les octets
chiffrés ou déjà protégés selon le modèle local. L'onglet destinataire relit la
source durable, importe, persiste puis actualise sa vue. Un onglet ne peut pas
accuser une update au nom d'un autre.

## 7. Autosauvegarde et états visibles

Le bouton principal « Enregistrer » disparaît. La surface affiche un état
unique dérivé du store :

| État | Copie utilisateur |
| --- | --- |
| transaction en mémoire | `Enregistrement local…` |
| commit local, réseau non requis ou différé | `Enregistré sur cet appareil` |
| updates en attente | `À synchroniser` avec quantité accessible |
| échange en cours | `Synchronisation…` |
| frontier confirmée et fichiers présents | `Synchronisé` |
| réseau absent | `Hors ligne — enregistré sur cet appareil` |
| ambiguïté | `Une décision est nécessaire` |
| quota/clé/protocole | message d'action précis, jamais `Synchronisé` |

Une animation ou un debounce réseau ne retarde jamais le commit local. Le
groupement réseau vise 250–1 000 ms d'inactivité ou une limite de taille, puis
envoie immédiatement au blur prolongé, retour en ligne ou fermeture propre. La
fermeture n'est pas le mécanisme principal de durabilité.

## 8. Interactions Notion-like V1

Chaque bloc éditable fournit, au clavier comme au pointeur/toucher :

- commande `/` filtrable et localisée ;
- poignée de bloc, sélection et menu d'actions ;
- glisser-déposer avec cible visible et annulation ;
- duplication, suppression, conversion et déplacement ;
- barre flottante pour texte, lien, page-link et couleurs ;
- indentation/désindentation des structures compatibles ;
- undo/redo de la session locale sans annuler silencieusement une update
  distante ;
- collage de texte riche assaini et fallback texte brut ;
- création de fichiers/images hors ligne liée à leur transfert durable.

Les actions de drag ont une alternative clavier. Le menu `/` n'affiche pas une
fonction XL indisponible. Tables, embeds et fichiers indiquent clairement leur
état hors ligne.

### 8.1 Liens externes et liens de page

Les liens Web standards restent des marques BlockNote et utilisent sa toolbar
communautaire Ariakit restylée. Le nœud inline `pageLink` conserve pour sa part
l'UUID canonique de la page cible ; il n'est jamais dégradé en simple URL ou
résolu par son titre.

Les deux familles partagent les actions produit suivantes :

- ouvrir la cible, avec navigation interne sans rechargement pour `pageLink` ;
- modifier le texte visible ;
- modifier la cible avec le sélecteur canonique de pages ou un champ URL ;
- retirer seulement la relation de lien en conservant le texte visible.

Pour un `pageLink`, retirer ou retargeter le lien ne supprime, ne déplace et ne
renomme jamais la page cible. Le contrôleur contextuel détecte le lien sous la
sélection ou le pointeur, fonctionne depuis la toolbar, le clic droit et le
clavier, et ferme ses menus avec `Escape` sans perdre la sélection.

## 9. Undo/redo

L'undo vise les transactions produites par la session locale courante. Il
produit de nouvelles opérations inverses et ne retire pas l'historique partagé.
Une transaction distante ne devient jamais la cible du prochain `Cmd/Ctrl+Z`.

Si l'inversion dépend d'un bloc supprimé ou transformé à distance, le modèle
retourne une action partielle explicite ou une ambiguïté ; l'adaptateur ne
recrée pas silencieusement un sous-arbre depuis un snapshot périmé.

## 10. Contrats de non-régression

- une édition locale et un move distant du même bloc gardent le texte avec le
  même UUID ;
- deux moves concurrents n'affichent jamais deux copies du bloc ;
- appliquer une update distante ne génère pas d'update locale en écho ;
- `fileEmbed` et `image` survivent à hydratation, modification voisine et
  projection ;
- un bloc/marque inconnu survit à une édition voisine ;
- IME, accents, emoji et paires de substitution conservent offsets/sélection ;
- le crash après chaque frontière de transaction retrouve soit l'état avant,
  soit l'état après, jamais un intermédiaire ;
- l'éditeur demeure navigable à 320 px, zoom 200 %, clavier seul et WebKit ;
- aucune dépendance `@blocknote/xl-*`, provider Yjs ou service distant n'entre
  dans le bundle.
