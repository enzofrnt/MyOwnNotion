# Relations entre bases pour des agrégations fiables

**Statut : préparation pour le prochain agent, aucune implémentation ni validation visuelle réalisée dans cette passe.**

## Intention et articulation

Permettre au propriétaire de choisir une base cible pour une relation, de relier ses entrées et d'exploiter leurs propriétés dans une agrégation, avec une expérience proche de Notion. Priorité : un parcours complet et fiable relation → agrégation, pas une simulation d'interface.

Cette feature étend la 009 et la 029 : les identités, l'appartenance aux sources et les pages/dossiers canoniques restent celles du canevas produit (§ 14 notamment). Elle lève, pour ce travail seulement, l'exclusion « Relation » de la 055 sans modifier les autres exclusions. La 055 reste propriétaire du calcul et de l'interface d'agrégation ; ses critères FR-015 doivent être revérifiés après correction des relations. La 009 autorise historiquement des liens vers toute page active : les valeurs déjà enregistrées restent lisibles ; ne pas convertir ni supprimer silencieusement des liens historiques qui ne correspondent pas à la nouvelle cible.

## Parcours et critères

### R1 — Définir une relation (P1)

Le propriétaire crée ou configure une propriété Relation et choisit la **source de données cible**, y compris une source vide ou une source située dans une page contenant plusieurs sources. Sa configuration s'applique à toutes les vues de la source d'origine et survit au rechargement et à la synchronisation. La sélection d'une base est possible par recherche ; vide, chargement, erreur et source inaccessible sont explicites. Les libellés et l'ordre exacts seront relevés dans Notion avant implémentation.

### R2 — Lier et retrouver des entrées (P1)

Dans une cellule ou le volet de page, proposer les seules entrées actives de la source choisie, sans confondre pages et dossiers valides. Rechercher, sélectionner, retirer et rouvrir une valeur ; supporter une cible ou plusieurs selon le réglage. Une référence utilise l'identité stable, pas le titre : renommage et déplacement ne doivent pas la casser. Vérifier explicitement auto-relation, pagination, doublons, limites, conflits et chargement partiel. Les entrées conservées mais indisponibles restent signalées, jamais discrètement effacées.

### R3 — Agréger une relation (P1)

Même sans aucune entrée liée, la configuration d'agrégation propose les propriétés de **la source configurée**, jamais celles d'une autre source. Le propriétaire lie deux entrées à 10 et 20, choisit leur propriété numérique et Somme : 30 dans la table et le volet ; une formule `prop("Total") * 2` donne 60. Filtre et tri utilisent le résultat avant pagination, en ligne et localement lorsque toutes les données sont disponibles. Si elles ne le sont pas, afficher l'indisponibilité sans inventer un résultat. Une propriété cible ou une source devenue invalide est explicitement signalée.

### R4 — Données existantes et continuité (P1)

Les relations créées avant cette évolution peuvent viser des pages hors base, plusieurs sources, ou une source non encore connue. Préserver leurs identités, leur lecture, leur export et leur synchronisation ; ne pas choisir automatiquement une cible ambiguë. Proposer une résolution explicite et non destructive avant toute restriction ou conversion. Le changement de cible, la réduction de cardinalité, l'archivage/suppression/restauration d'une source, propriété ou entrée doivent exposer leur impact et permettre une reprise sûre. Aucun reset implicite.

### R5 — Relation inverse (P2, après référence et conception)

Étudier puis prendre en charge une relation réciproque à la manière de Notion si faisable avec les garanties du produit : une seule vérité canonique, pas deux copies divergentes ; créations/retraits, renommages, suppression/restauration, auto-relation et écritures simultanées doivent rester cohérents. Ne pas afficher d'option inactive ou de fausse relation inverse. Si une décision d'architecture ou une règle produit manque, documenter le blocage avant de prétendre la story terminée.

## Exigences transversales

- Les mêmes règles de validation s'appliquent en API et hors ligne ; les entrées d'une autre source sont refusées pour une nouvelle relation configurée, sans casser la lecture des données anciennes.
- Contrôle du workspace et des entrées actives ; aucune fuite de titres ou de contenu dans les erreurs/logs. Protéger les relations métier internes contre un contournement par l'API de relations génériques.
- Contrat et migrations compatibles : anciennes définitions, anciennes versions des clients, outbox, reprise sync, sauvegarde/restauration, import/export ; choisir et tester une stratégie avant changement durable.
- Interface : suivant `ui-quality`, ses leçons et `notion-parity`, relever structure, libellés et comportements réels ; vérifier clavier, focus, Échap, écran vide/erreur/chargement, textes longs, clair/sombre et 320/390 px. Aucune donnée personnelle dans les preuves.

## Limites du cadrage

Cette préparation repose sur lecture du code et documentation officielle, pas sur une nouvelle capture Notion ni une exécution des scénarios. La cardinalité exacte, les changements destructifs, la réciprocité, les auto-relations et les cas hors ligne doivent être observés ou clairement qualifiés avant implémentation. Pas d'affirmation de parité avant comparaison du candidat réel.
