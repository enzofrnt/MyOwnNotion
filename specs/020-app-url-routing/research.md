# Research: URLs canoniques de l’application

## Decision 1 — React Router 7 en mode déclaratif

**Decision**: Ajouter `react-router-dom` 7.18.2 exactement et utiliser `BrowserRouter`, `Routes`, `Route`, `Outlet`, `Navigate`, `useParams`, `useLocation`, `useNavigate` et `useSearchParams`.

**Rationale**: Le produit est une SPA navigateur ; ces primitives couvrent l’historique natif, les segments dynamiques, les layouts persistants, les redirections et les requêtes sans imposer un cycle de données réseau. La version 7 reste compatible avec React 19.2.4 et évite les prérequis plus récents de la ligne 8. La dépendance exacte respecte la reproductibilité Bun.

**Alternatives considered**:

- `createBrowserRouter`/`RouterProvider` : loaders/actions inutiles ici et susceptibles de coupler le gate local-first aux chargements du routeur.
- `HashRouter` : évite le fallback serveur mais ne satisfait pas les URLs canoniques demandées.
- Routeur History API maison : reproduirait reconnaissance, popstate, imbrication et contexte déjà maintenus par une bibliothèque standard.
- React Router 8 : prérequis React/runtime supérieurs au checkout et migration sans valeur pour cette feature.

## Decision 2 — Layout protégé persistant

**Decision**: Monter le workspace une seule fois sous un layout protégé, le masquer pendant les réglages et rendre les pages secondaires via un outlet.

**Rationale**: L’implémentation actuelle protège volontairement les brouillons, connexions temps réel, scroll et focus en gardant `HierarchyExplorer` monté. Une navigation ne doit pas réintroduire de perte silencieuse ou de remonte de l’éditeur.

**Alternatives considered**:

- Démonter/remonter le workspace entre notes et réglages : plus simple visuellement mais risque les brouillons transitoires et multiplie les initialisations Dexie/CRDT.
- Déplacer tout l’état du workspace dans un provider global : refactorisation plus large sans besoin actuel.

## Decision 3 — Identité dans le chemin, contexte dans la requête ou l’état

**Decision**: Porter toute identité de page/dossier/base/entrée dans `/notes/:itemId`. Garder `?view=` pour la vue de base et réserver `history.state`/`sessionStorage` au scroll, focus et chemin de retour.

**Rationale**: L’UUID survit au renommage, déplacement et conversion. Le contexte de vue est propre à l’onglet et ne doit pas devenir une seconde identité. Un rechargement reste résolvable sans état mémoire.

**Alternatives considered**:

- Slug de titre : instable et impose des alias/redirections.
- `?item=` ou `?entry=` : conserve tout sur une seule page et rend l’identité moins structurante.
- Chemins hiérarchiques : cassés par les déplacements et réordonnancements.

## Decision 4 — Retour d’authentification explicite et validé

**Decision**: Utiliser `returnTo` uniquement pour un chemin interne reconnu, encodé dans la requête de `/login` ou `/setup`, puis effectuer un remplacement après succès.

**Rationale**: Le chemin survit au rechargement du formulaire tout en empêchant les redirections ouvertes. Le remplacement évite de revenir vers une page de connexion obsolète.

**Alternatives considered**:

- URL externe ou absolue : risque de redirection ouverte.
- État React seulement : perdu au rechargement.
- `history.state` seulement : moins inspectable/testable et absent lors d’un lien copié.

## Decision 5 — Shell de navigation hors ligne explicite

**Decision**: Ajouter une route Workbox de navigation vers l’`index.html` précaché, avec exclusions API et assets, et conserver le fallback nginx existant.

**Rationale**: `precacheAndRoute` précache les fichiers émis mais ne transforme pas à lui seul `/notes/:id` en clé d’`index.html` lors d’une navigation hors ligne. Le contrat local-first exige un démarrage depuis une route profonde déjà chargée.

**Alternatives considered**:

- Compter uniquement sur nginx : impossible hors ligne.
- Mettre en cache les réponses API : créerait une source de vérité concurrente à Dexie et à la synchronisation chiffrée.

## Decision 6 — Validation multi-couche et agents économiques

**Decision**: Tests purs et composants pour les invariants de route, contrats pour la distribution, journeys Playwright pour les parcours ; sous-agents `gpt-5.6-luna` à faible effort pour surveiller chaque commande longue de tests/CI demandée.

**Rationale**: Les erreurs de reconnaissance se diagnostiquent vite en test pur, tandis que rechargement, offline, focus et historique nécessitent un navigateur réel. La surveillance économique répond à la demande sans remplacer les codes de sortie ni les artefacts.

**Alternatives considered**:

- Playwright uniquement : lent et peu précis pour les règles de sécurité de chemins.
- Tests composants uniquement : ne valident ni le serveur de routes, ni le service worker, ni l’historique réel.
