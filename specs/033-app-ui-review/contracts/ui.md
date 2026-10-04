# Contrats UI

- Primitives exportées par `apps/web/src/ui/index.ts` et `primitives/index.ts`.
- Classes de domaine adaptent géométrie, sans écraser arbitrairement variantes.
- Tableau de lecture : structure sémantique conservée, scroll local ; aucun
  remplacement des tableaux éditables ou virtualisés par une abstraction générique.
- Tous les exemples conditionnels utilisent composants réels et adapters mémoire.
- Overlays : focus initial/Échap/retour au déclencheur et actions sémantiques.
- Captures : vrai navigateur, thème/dimensions/état attestés ; limites indiquées.

## Extensions livrées

- `Section` : attributs/ref de section, titre/actions fournis par le consommateur.
- `NativeInput`, `NativeSelect` : attributs/ref natifs et `density`, sans état
  contrôlé imposé ; `multiple`, `size`, `defaultValue` et `FormData` conservés.
- `ReadTable` : attributs/ref de table et `scrollLabel` obligatoire ; caption,
  cellules et en-têtes natifs, section de défilement au clavier.
- `CodePreview` : attributs/ref de pre, `prose` optionnel ; défilement local.
- `Skeleton layout="media"` : bloc décoratif dans le cadre réservé à l’aperçu.
- `.ui-actions` : groupe flexible, gap commun, retour à la ligne.

`FilePreviewSurface`, `DesktopUpdateSurface`, `DesktopVaultNotice` séparent la
présentation de leurs contrôleurs existants. `RevisionRestore` accepte une API
locale optionnelle ; sa valeur par défaut conserve l’API de production.
`PageEditor fileTransfersEnabled={false}` empêche un dépôt/collage de fichier
d’utiliser la file persistante dans le lab ; le défaut de production reste `true`.
