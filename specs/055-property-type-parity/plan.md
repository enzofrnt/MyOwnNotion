# Plan d'implémentation — parité des types de propriété

**Feature**: 055-property-type-parity | **Date**: 2026-11-06 | **Spec**: `spec.md`

## Résumé

Étendre le modèle de propriété par un `config` discriminé par type, exposer un
panneau de configuration latéral dans le menu de colonne, puis implémenter les
rendus/éditeurs/calculs par type. Commencer par la fondation et Nombre, puis
Dates, État, Identifiant, Agrégation, Fichiers, Formule, Lieu.

## Contexte technique

- Bun + TypeScript, React 19, Vite, PostgreSQL/Drizzle, Ariakit, Vitest, Playwright.
- `packages/domain` : `DatabaseProperty`, schéma, commandes, valeurs, requêtes.
- `apps/api` : persistance et endpoints des bases.
- `apps/web` : `database.css`, `table-view.tsx`, `property-configuration.tsx`,
  éditeurs de cellules, panneaux de vue.
- Fichiers : stockage protégé existant (`apps/api/src/files`, blobs).
- Google : Places API (recherche/adresse) + Maps JavaScript (vue Carte).
  Variables : `MYOWNNOTION_GOOGLE_MAPS_API_KEY` (serveur, Places) et
  `MYOWNNOTION_GOOGLE_MAPS_BROWSER_KEY` (navigateur, Maps JS restreinte).
  Sans clé : recherche indisponible avec un message explicite.
- Formule : évaluateur typé côté web/domaine, sans IA ; interface éditeur.

## Contrôles constitution

- Single-user : aucune identité supplémentaire.
- Confidentialité : clés non journalisées ; lieux et fichiers restent locaux.
- Résilience locale : valeurs stockées localement ; Google est un enrichissement,
  pas le seul chemin de lecture ; la carte se dégrade proprement.
- Toolchain Bun ; tests/format/types bloquants.
- UI quality + notion-parity : captures, états, clair/sombre, clavier.

## Architecture

1. **Domaine** : configs typées (`NumberConfig`, `DateConfig`, `StatusConfig`,
   `UniqueIdConfig`, `RollupConfig`, `PlaceConfig`), validation de schéma,
   valeurs par défaut pour les propriétés existantes, helpers de lecture.
2. **API** : sérialisation des configs, validation, migration des données
   existantes, endpoints Google Places (proxy serveur) et upload fichiers.
3. **Web** : panneau `Modifier la propriété` (popover latéral) + formulaires
   par type ; formatage des cellules ; éditeurs (date, état, lieu, formule) ;
   vue Carte ; limites fichiers.
4. **Google** : proxy Places côté API (secret serveur) ; carte côté web avec clé
   navigateur restreinte ; pins et popup ; chargement paresseux.
5. **Formule** : éditeur type Notion (propriétés, fonctions/docs, aperçu,
   débogage, type), évaluateur typé sans IA ; palier 1 = opérateurs + propriétés
   + fonctions de base, palier 2 = couverture complète.
6. **Tests** : domaine (config, validation, calculs), web (rendu/édition),
   intégration API, Playwright pour les surfaces et Google si clé.

## Phases

- P0 Fondation : config panel + menu + captures ; aucun changement de données.
- P1 Nombre + Dates.
- P2 État + Identifiant.
- P3 Agrégation.
- P4 Fichiers.
- P5 Formule.
- P6 Lieu + Carte (clé Google).
- P7 Tests/validation/preuves, convergence.

## Risques

- Volume de la formule (langage complet) : phaser, interface d'abord.
- Google Maps : clé/quotas/coût ; consentement et restriction de clé.
- Limites fichiers : notre app n'a pas de notion de plan ; appliquer les limites
  Notion documentées (5 Mo gratuit ; PDF 20 Mo et images 5 Mo payant) via une
  configuration de déploiement, par défaut les limites payantes documentées.
- Migration des propriétés existantes : ajouter des défauts sans réécrire les
  valeurs ; tester les bases existantes.

## Reprise prioritaire — 2026-11-11

La cible et les scénarios FR-015 à FR-018 de `spec.md` priment sur les
affirmations historiques de complétude. Lire `audit-reprise.md` avant toute
modification ; 045/047 décrivent des paliers antérieurs, non la cible étendue.
L'ordre demandé est agrégations, formules, puis lieu/carte ; les investigations
indépendantes peuvent être menées en parallèle, mais les changements de calcul
et contrats partagés doivent être coordonnés.

### Décisions de conception à arrêter après capture

- Établir une matrice relation → source cible → propriété → calcul applicable,
  y compris valeurs vides, cibles supprimées, erreurs, formules et listes. Ne pas
  présumer que 24 fonctions suffisent ou sont toutes applicables partout.
- Définir un résultat typé distinguant valeur, vide, erreur et données locales
  incomplètes ; unifier son interprétation et son formatage entre domaine, API,
  projection locale, table, autres vues, volet, formules et aperçu. Calculer
  avant filtre/tri/pagination ; conserver les garanties de performance de 009.
  Évaluer le coût avant de choisir calcul partagé ou adaptations de projection.
- Formules : inventorier grammaire et fonctions par rapports aux docs officielles
  et captures, définir types, coercitions, dates/fuseaux, bornes de ressources,
  références stables, cycles et profondeur. Préciser migration/compatibilité des
  expressions par nom, sans casser les formules sauvegardées ; versionner les
  sémantiques si nécessaire. L'import Notion actuellement basé sur des instantanés
  n'est pas à présenter comme une importation de formule exécutable.
- Lieu : conserver Google Places/Maps déjà décidé, mais traiter explicitement
  divulgation des requêtes et coordonnées, consentement/contrôle, quotas,
  restrictions de clés et réessai ; pas de journalisation de recherches, même
  via les intermédiaires contrôlés. Étudier classement, langue, couverture et
  configuration sans promettre une qualité identique à Notion ou un fournisseur
  identique. Rester utilisable en lecture hors ligne et documenter les limites.
- Traiter sauvegarde/restauration, export/import, changements de schéma,
  synchronisation et données partielles ; aucune réinitialisation de données
  utilisateur. Définir le comportement avec ancien client avant tout changement
  de contrat, et les éventuels mécanismes de migration ou garde de protocole.

### Contrat de calcul arrêté — 2026-11-11 (T101)

- **Lieu du calcul** : `packages/domain`. `createDerivedValues(definition,
  { rollups, relationTitle, now })` est l'unique résolveur ; il mémorise par
  entrée et sert l'affichage, le tri et le filtre.
- **Agrégation** : `RollupCell = string | number | null | (string | number |
  boolean)[]`. `null` = calculé et vide ; `undefined` (clé absente sur le fil)
  = non calculable (cible ou calcul invalide, corpus local partiel). Le type
  de résultat découle du calcul (`rollupResultKind`). Calculs admis par type de
  cible : `rollupFunctionsForType`. Projection serveur : cible inconnue =
  supprimée, ignorée. Projection locale : cible inconnue = non calculable ;
  cible archivée = ignorée.
- **Formule** : valeurs texte, nombre, booléen, date (`{ time, end?, hasTime }`),
  liste, vide. Erreur ≠ vide : une erreur porte un message et une position.
  Références par nom (`prop("Nom")` ou identifiant nu), 15 niveaux, cycles
  refusés, 200 000 pas, 20 000 caractères, 10 000 éléments. Dates civiles en
  UTC, instants dans le fuseau de la machine qui évalue. Division par zéro et
  résultat non fini → vide. `dateBetween(a, b)` = a − b, tronqué, comme Notion.
- **Tri/filtre** : une valeur dérivée se compare comme texte, nombre, case ou
  instant ; kinds différents → ordre stable par kind ; vide = absent.
- **Compatibilité** : rien de dérivé n'est stocké ; aucune migration. Les
  formules enregistrées restent valides (une relation lue comme nombre vaut
  toujours son nombre de pages). Changement assumé : `empty(0)` est vrai,
  `replace` prend une expression régulière, `dateBetween` change de signe.
- **Lieux** : Google Places conservé ; recherche en corps de requête POST ;
  jeton de session par recherche ; position actuelle jamais transmise.

### Gate de conception UI et sécurité

Appliquer [ui-quality](../../.agents/skills/ui-quality/SKILL.md), son
[journal](../../.agents/skills/ui-quality/lessons.md), le
[guide UI](../../docs/design/ui-system.md), le registre 054 et
[notion-parity](../../.agents/skills/notion-parity/SKILL.md). Pour chaque
parcours, documenter repos, survol, focus, ouvert, vide, chargé, chargement,
refus, erreur/reprise, valeurs longues, écran étroit et clair/sombre. Relever
les parcours souris/clavier, Échap et retour du focus ; vérifier le clic droit
quand pertinent. Les captures de test doivent utiliser des données synthétiques,
jamais le workspace personnel. Ne pas ajouter d'action ou de faux état pour
simuler une capacité non implémentée.

Avant tout code, capturer la référence Notion et le candidat existant dans le
même état, avec recettes reproductibles et tableau des écarts. Consigner les
points impossibles à observer ; une documentation officielle n'est pas une
preuve des détails UI. Après code : captures comparables et tests Playwright
sur les profils applicables, ainsi que tests de domaine, intégration et contrat.
Le jalon UI reste ouvert si la comparaison ou une revue réelle manque.

## Preuves attendues

Captures Notion/candidat dans `.notion-lab/parity/`, `evidence/`, tests,
`validation.md` ; comparaison structure/styles/états.
