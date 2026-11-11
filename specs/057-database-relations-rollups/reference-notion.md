# T001 — Référence Notion : relation existante

## Cadre et méthode

Observation réelle le **11 novembre 2026**, Chromium headless via Bun Playwright, profil de test autorisé `.notion-lab/profile`, français, thème clair, viewport 1440 × 1000. [Page et vue autorisées](https://app.notion.com/p/3e8d891cc8ef8008b2d2d5b80c3791b4?v=3e8d891cc8ef80f5aaa4000cb867b79b). Session accessible, sans nouvelle authentification ni contournement.

Skills `notion-parity` et `ui-quality` chargées ; journal UI lu. Travail limité à la référence, sans candidat, implémentation ni validation de parité. Aucun changement de code app, plan ou tâches réalisé par cette intervention.

La propriété existante a été identifiée par la coche **Relation** dans le sous-menu « Modifier le type », et non par son nom personnalisé. Elle est à l’index de colonne DOM 6 dans cette vue au moment du relevé ; cet index n’est pas une identité pérenne.

Seuls des overlays recadrés ont été enregistrés. Noms de propriété/base/entrée, champs remplis, images et tout texte hors liste blanche ont été masqués **avant** l’écriture des PNG. Certaines commandes génériques sont également masquées par prudence. Aucun screenshot global, sidebar, HTML brut, cookie, stockage du profil ou réponse réseau n’a été exporté. Le masquage de texte utilise des rectangles de Range sans modifier la mise en page native. Toutes les images finales ont été ouvertes et contrôlées visuellement.

Recette exécutable locale ignorée : [script de capture](<.notion-lab/057-capture.mjs>). Données géométriques expurgées et horodatage exact : [mesures](<specs/057-database-relations-rollups/evidence/reference/measurements.json>).

## Observations établies

### 1. Menu de propriété et clic droit

Le clic normal sur l’en-tête ouvre un menu contenant notamment, dans cet ordre relatif : « Modifier la propriété », « Modifier le type », « Filtrer », « Trier », « Calculer », « Masquer », puis « Supprimer la propriété ». La liste est volontairement partielle : les autres libellés n’ont pas tous été admis par la liste blanche.

Le clic droit sur le même en-tête ouvre la même surface logique. Les deux captures finales ont la même empreinte SHA-256 après expurgation ; ce n’est pas seulement une déduction depuis le code.

- [Menu au clic normal](<specs/057-database-relations-rollups/evidence/reference/01-relation-property-menu.png>)
- [Menu au clic droit](<specs/057-database-relations-rollups/evidence/reference/06-relation-header-context-menu.png>)

### 2. Panneau de configuration existant

« Modifier la propriété » ouvre un panneau secondaire à trois rangées, dans cet ordre :

1. **Liée à** — nom de source cible expurgé ; rendu atténué dans cette session.
2. **Limite** — valeur courante **Aucune limite**, chevron.
3. **Ajouter une propriété liée** — état courant **Désactivé**, chevron.

Le relevé ne prouve pas que la source d’une relation existante puisse être changée : aucune sélection de source n’a été tentée. La capture conserve la densité réelle, y compris la proximité des libellés et valeurs de la dernière rangée.

[Configuration de la relation](<specs/057-database-relations-rollups/evidence/reference/02-relation-configuration.png>)

### 3. Cardinalité

Un clic sur « Limite » ouvre un autre menu, deux choix exacts :

1. **1 page** ;
2. **Aucune limite** — cochée sur la relation observée.

La première rangée est survolée dans la capture, sans activation. Aucun choix n’a été sélectionné ; ni réduction de cardinalité, ni dialogue de perte de données, ni remplacement d’une valeur n’ont été testés.

[Choix de cardinalité](<specs/057-database-relations-rollups/evidence/reference/03-relation-cardinality.png>)

### 4. Réciprocité : configuration seulement

Un clic sur « Ajouter une propriété liée » ouvre un petit dialogue avec :

- **Activer**, contrôle de rôle `switch` ;
- **Nom de la propriété liée**, champ texte, dont la valeur est expurgée.

Le panneau parent indique **Désactivé**. L’interrupteur n’a **jamais** été actionné et le nom n’a pas été saisi. L’existence de ce réglage est établie ; création effective, contenu de la propriété inverse, propagation des ajouts/retraits et garanties de cohérence **ne sont pas vérifiés**. L’attribut `aria-checked` du switch était absent lors du relevé : l’état est rapporté depuis le panneau parent, pas inventé depuis cet attribut.

[Dialogue de propriété liée](<specs/057-database-relations-rollups/evidence/reference/04-reciprocal-configuration.png>)

### 5. Cellule vide et sélecteur

Une seule ligne était rendue dans la table inspectée ; sa cellule Relation était vide. Un clic dans cette cellule ouvre un overlay comprenant :

- un champ **Lier ou créer une page…** ;
- un accès à la source cible, nom expurgé ;
- l’intitulé **Sélectionner une page** et une commande « … » ;
- une proposition avec icône de page, titre expurgé et commande **+** à droite.

Aucune proposition, commande + ou création n’a été activée. Aucune recherche n’a été saisie. Le comportement d’une cellule remplie, le retrait d’un lien, la navigation vers une entrée et l’éditeur Relation dans un volet d’entrée restent donc inconnus.

**Échap** ferme l’overlay de cellule : zéro dialogue restant après 250 ms. Le focus observé retourne à `BODY`, pas à la cellule ; aucun parcours clavier complet n’est revendiqué.

[Sélecteur de cellule vide](<specs/057-database-relations-rollups/evidence/reference/05-relation-cell.png>)

## Géométrie effectivement mesurée

Mesures CSS du conteneur ciblé, pas des pixels de l’ombre extérieure :

| Surface | Boîte CSS, px | Rayon du conteneur | Rangées |
| --- | --- | --- | --- |
| Menu d’en-tête normal / contextuel | 291,30 × 469 | 10 px | 28 px, rayon 6 px |
| Configuration | 300 × 94 | 10 px | 292 × 28 px, rayon 6 px |
| Cardinalité | 250 × 65 | 10 px | 242 × 28 px, rayon 6 px |
| Dialogue propriété liée | 250 × 119 | 10 px | non mesurées séparément |
| Sélecteur cellule | 560 × 116 | 6 px | proposition 32 px ; + 20 × 20 px |

La coordonnée verticale fractionnaire explique que certains PNG fassent un pixel de plus que la hauteur CSS. Les boîtes `role=menu` rapportent un fond transparent et aucune ombre : ce sont des wrappers, **pas** la preuve d’une surface peinte transparente/sans ombre. Les dialogues de cellule et de propriété liée rapportent un fond blanc, texte `rgb(44, 44, 43)`, ombre en trois couches (valeurs dans les mesures). La taille héritée relevée sur les wrappers est 16 px ; elle ne vaut pas mesure exhaustive de la typographie de chaque libellé. Pas de transposition de ces couleurs en tokens applicatifs dans cette tâche.

## Préservation et limites

- Aucun ajout/retrait de relation, choix de cardinalité, activation réciproque, renommage, changement de type ou de source. Aucun changement d’autres données.
- Après rechargement, les valeurs textuelles des cellules Relation rendues ont été comparées en mémoire : **inchangées**. Seul le booléen de comparaison est exporté, pas les valeurs. Ce contrôle est limité aux cellules visibles, pas un audit serveur global.
- Les seules interactions persistantes du navigateur sont celles nécessaires au profil et au chargement normal ; pas d’accès au contenu des fichiers du profil, aux secrets ou aux API internes.
- Des essais d’automatisation ont rencontré un timeout de clic intercepté par un overlay resté ouvert. Ils n’ont pas forcé le clic ni contourné l’UI : fermeture du contexte puis reprise ; la recette finale utilise un rechargement entre ces parcours et termine avec code 0.
- Non observés : création d’une relation/source vide, cardinalité appliquée, relation déjà remplie, effet réciproque, auto-relation, agrégation, mutation destructive, conflit, erreur, chargement, hors ligne, thèmes sombres, 320/390 px, recherche sans résultat, pagination, parcours clavier complet et volet d’entrée. Les garanties fonctionnelles correspondantes ne peuvent pas être déduites des captures.
- Pas de tests/build de l’app exécutés : cette passe n’a aucun changement de code app et ne constitue ni une validation fonctionnelle de R1–R5 ni une comparaison candidat/référence.

## Reproduction minimale sans mutation

1. Ouvrir uniquement la page/vue de test autorisée avec le profil Chromium existant.
2. Identifier la Relation par la coche de son type, sans choisir un autre type.
3. Ouvrir le menu d’en-tête, puis « Modifier la propriété ».
4. Ouvrir « Limite » ; observer la coche, **ne sélectionner aucun choix**.
5. Revenir, ouvrir « Ajouter une propriété liée » ; **ne pas actionner Activer ni remplir le nom**.
6. Recharger, ouvrir la cellule Relation vide ; **ne pas cliquer sur un candidat ou +** ; Échap.
7. Recharger et vérifier le menu au clic droit.
8. Capturer uniquement les conteneurs d’overlay avec masquage préalable ; ne jamais sauvegarder le viewport complet.
