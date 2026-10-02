# Plan — Standardisation CSS

Feature 031 ; branche codex/031-css-system ; premier commit Slopo b782a106.
Références canevas 4/12/13/14/39/43.6/46 ; spec.md ; research.md.

## Contexte technique

Bun 1.4.2, CSS natif, Tailwind 4, React/Ariakit/BlockNote existants. Pas de
nouvelle dépendance, backend, API ou migration. Sources main.tsx → global.css.
Le CSS MCP est importé par son composant. ui-quality et lessons.md sont chargés :
`.agents/skills/ui-quality/SKILL.md`, `.agents/skills/ui-quality/lessons.md`.

## Architecture et propriétaires

- ui/tokens.css : palette + métriques communes ; compatibilité conservée.
- ui/base.css : reset minimal, texte de base, sélection et floor 320 px.
- ui/compatibility.css : contrôles natifs historiques et helpers transversaux.
- ui/primitives/primitives.css : contrôles communs et leurs états explicites.
- features/{databases,editor,search,knowledge-graph,auth,security,files,
  navigation,save-state,reconciliation}/ : styles des domaines concernés.
- features/workspace/workspace.css : canevas, titre, onglets, outline, enfants.
- features/settings/{settings,settings-security}.css : propriétaires distincts
  réglages/document sécurité ; éliminer leurs règles dupliquées.
- global.css : imports explicites, aucun corps de feature.
- docs/design/ui-system.md : mode d’emploi actuel, carte de propriétaires,
  recettes et politique d’extension ; lien court depuis skill et développement.
- ui/ui-lab : vitrine interactive des composants et compositions réels.

Les règles sont déplacées avec conditions/sélecteurs inchangés puis les aliases
remplacés par leurs cibles exactes. Les différences voulues (focus sémantique,
lien normal, alignement icône/libellé) sont bornées et inspectées. La transition
ne doit ni introduire une nouvelle bibliothèque ni tout reconstruire avec des
utilitaires. Les composants de domaine conservent leurs géométries validées.

## Gate constitution

Clarification pendant réalisation : accents bleu `#4481D8` et rouge `#D56C5E`
dans les deux thèmes, hover dérivé, palette des propriétés inchangée.
Nouvelle clarification : focus commun 1 px neutre sans box-shadow de halo ;
Status transparent, titre en texte principal et aide muted ; danger transparent
avec texte/bordure rouges, menu rouge à l’interaction. AsyncState loading compose
un Skeleton décoratif (lignes ou table, nombre de rangées borné) et conserve
l’annonce d’attente. Les features peuvent fournir un placeholder contextualisé ;
ne pas remplacer du contenu disponible pendant une mise à jour en arrière-plan.
Le lab réserve un cadre constant et permet de comparer attente/contenu.
Le sélecteur de couleurs du lab compose Button avec les neuf tokens de contenu
existants : fond soft, contour/point de même teinte, choix et nom en état local.
Cet exemple ne crée pas de primitive globale ni de nouvelle palette.
La revue du vrai BoardView révèle que le parent libère son `overflow` : exclure
le scrollport Kanban de cette règle au même propriétaire, sans changer la table.
La revue à 320 px révèle aussi des libellés masqués positionnés hors de leur
scrollport et une carte élargie par son titre long : placer le scrollport comme
contexte de positionnement et borner la piste de carte avec retour à la ligne.

Cœur pur, stockage/offline/chiffrement inchangés. Aucun contenu utilisateur
transmis ni manipulé pour les références. Tests des comportements du lab,
typage/build/lint ; revue de vrais composants requise. E2E différés par instruction
utilisateur, pas de push/release sans futur gate complet. Dérogation locale
explicite au parcours E2E : standardisation et revue de composants, revue complète
au prochain passage E2E demandé. Aucun affaiblissement du gate de livraison.

## UX et vérification

Parcours : contenu principal + chrome discret ; action unique, état vide avec
reprise ; erreur garde saisie ; busy garde dimensions ; hover/focus stables ;
menu/dialogue/panneau ouverture clavier, Escape et retour de focus. States lab :
repos, long, vide, erreur, occupé, désactivé, overlay. Baseline puis comparaison
clair/sombre, 320/1280 px, zoom 200 %, contenus larges scroll interne.

Gate visuel pour US1/US2/US3 : preuves par story dans verification.md et assets.
Un écart matériel bloque clôture. Maintenir l’inventaire avant/après et les
exceptions ; ne pas écrire de tests copiant simplement des valeurs CSS. Utiliser
les suites UI existantes et tests du comportement réellement changé du lab.

## Livraison

spec → recherche/plan → tasks → analyse → implémentation → convergence.
Second commit dédié après revue ; aucun push demandé. Tout travail restant garde
une tâche ouverte. Guide et références restent dans sources partagées, pas chat.
