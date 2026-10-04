# Recherche — système de styles

## Constat vérifié

14 feuilles, 11 447 lignes ; global.css 4 043, workspace.css 2 873.
Le système de tokens/primitives existe. La difficulté est la découverte des
compositions, des propriétaires et des effets de cascade. Recherche indépendante
en lecture seule réalisée pendant speckit-plan, puis relue avec les sources.
Slopo analyse TS/TSX ici ; il ne mesure ni cascade, ni rendu CSS. L’inventaire de
règles et la comparaison du navigateur sont adaptés à cette feature.

## Décisions

1. **Propriétaires par domaine**, global devient manifeste. Extraire les règles
   existantes et conditions media ; préserver leur ordre relatif dans chaque
   domaine et vérifier les intersections. Les bases sortent de workspace ; les
   corrections de sécurité sont réunies sous leur propriétaire. Alternative
   rejetée : ajouter des overrides en fin de global (rend le prochain changement
   plus fragile) ou une nouvelle bibliothèque de composants.
2. **Tokens --ui-* canoniques** pour le nouveau code ; aliases publics de 017 et
   anciens aliases conservés pour compatibilité. Remplacer les consommations CSS
   historiques par leur cible exacte, sans arrondir les géométries validées.
   Les couleurs locales intentionnelles deviennent tokens avec leurs valeurs
   actuelles. Les variables Ariakit/Shiki/CRDT/graph et dimensions dynamiques
   restent des données de composants, explicitement documentées.
3. **Compatibilité native isolée** : ne pas modifier implicitement les primitives
   communes ou éditeurs tiers. Le reset garde héritage et box sizing ; une feuille
   de compatibilité identifiée garde les boutons/champs historiques. Vérifier les
   vrais déclencheurs Ariakit, pas seulement Button. Pas de nouvelle couche CSS
   globale : cela changerait la priorité par rapport à BlockNote/Tailwind.
4. **Compositions concrètes** : guide maintenu et laboratoire interactif avec
   composants réels. Préserver le mode déterministe `overlay` des snapshots et
   rendre la route normale non contrôlée. Le journal de leçons reste inchangé :
   une nouvelle leçon demande validation explicite du propriétaire.
5. **Comparaison avant/après** : screenshots et propriétés calculées pour thèmes,
   densités, largeur 320/1280, texte long, états/focus/overlays. Aucune E2E suite.

## Risques à vérifier

- Déplacement de règles avec même spécificité : comparer ordres des sélecteurs
  et déclarations, puis styles calculés ; aucune affirmation sur le seul build.
- Native vs commun : ui-menu__item rend un div par défaut ; ses variants bouton
  et les déclencheurs nus doivent rester explicites.
- Styles de tables `100cqi`, portails `.bn-drag-preview`, `!important` de drag et
  node-selection : adaptations tierces intentionnelles à conserver.
- Token absent `--text-md` (héritage actuel), focus absent avec fallback accent,
  contraste accent absent avec fallback blanc : corriger explicitement le contrat
  et documenter les différences attendues, ne pas remplacer au hasard.

## Sources Spec Kit

Clarification ultérieure : les pastels d’accent sont remplacés par les références
bleu/rouge du propriétaire (spec.md) ; la palette des options est préservée.
Le rendu réel du BoardView dans une base révèle un `overflow: visible` hérité
de la libération du tableau. Exclure explicitement le scrollport Kanban de cette
règle (même spécificité) ; preuve avant/après dans verification.md.
La reprise de revue mobile avec texte long confirme deux autres causes : les
labels masqués absolus échappent au scrollport statique et élargissent le document
de 20 px ; la piste implicite de carte prend la largeur intrinsèque du titre.
Corriger ces contextes au même propriétaire, sans masquer le débordement du body.

017 FR-033–045/FR-048 et contracts/ui-system.md ; 022 FR-018/FR-030 ;
023 FR-006–008 ; 029 FR-007/FR-011/FR-030 ; 003 FR-017–021.
Canevas 43.6 ; ui-quality et leçons L-001 à L-017 (L-009/L-010 pour cascade).
La feature 021 concerne les logs, elle ne constitue pas une référence UI.
