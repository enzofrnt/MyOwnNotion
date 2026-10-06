# Research decisions

## Canonical creation

Decision : passer initialValues dans la commande `database.entry.create`, jamais une deuxième mutation. Recherche agent import_hierarchy : `DatabaseContainerPage` et blocs intégrés partagent `DatabaseViewSurface` ; callbacks actuels jettent les valeurs. Identité/source/type/parent/valeurs sont déjà atomiques dans LocalContentService + outbox. Après succès ouvrir l'entrée par son identité, même filtrée.

Une lacune constatée dans la préparation locale : la validation choisit la définition primaire même pour sourceId secondaire. Résoudre explicitement databaseSources[sourceId] et vérifier le propriétaire ; tester source secondaire/refus sans écriture partielle. Pas de migration ni nouveau protocole. Le résultat ok confirme la durabilité locale, l'indicateur de synchronisation existant reste honnête.

Alternative écartée : création puis values.replace, qui crée un état intermédiaire incorrect et un risque de refus partiel.

## Page viewport and headers

Decision : réutiliser le viewport visible de la table avec origine de liste paramétrable ; virtualiser les cartes sur workspace-main, hauteur totale + gap de 8 px + focused item. Recherche agent math_design : deux plafonds verticaux Kanban créent le scroll imbriqué ; offset absolu d'une carte = start-scrollMargin.

Décision finale après revue propriétaire : remplacer les translations scroll/rAF par une fixation CSS sticky native. Le rail d'en-têtes est frère du corps horizontal, et non son descendant. Le premier ancêtre scrollable est donc le workspace vertical ; l'étendue de la base borne naturellement le rail. Chaque commande est rendue une seule fois ; les tables de header/corps réutilisent les mêmes colgroups. Le corps devient l'unique source de scroll horizontal : le contenu d'en-têtes suit sa ScrollTimeline directement, au lieu de copier scrollLeft après un événement. Le rail d'en-têtes clippé transmet gestes et focus horizontaux au corps. Sur moteur sans timeline, coordonner wheel et traduction dans le même handler, avec écoute scroll de secours. Le hook mesure au layout/resize retrait, gouttière et course et nettoie son animation/listeners. Pas de clone ni de portal. Dans les widgets bornés, garder les en-têtes dans leur structure d'origine.

Motif : la translation calculée en JavaScript répondait à la géométrie après une frame, mais restait visiblement instable pendant le geste. Un sticky placé sous overflow-x:auto se fixe au mauvais ancêtre, même si ce dernier ne possède pas le scroll vertical ; confirmation dans la [documentation CSS position](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/position). La nouvelle structure retire cet obstacle au lieu de compenser le scroll vertical par script.

Le quatrième retour révèle le même délai sur les copies de scrollLeft, bien qu'à l'arrêt la géométrie soit exacte. La [ScrollTimeline native](https://developer.mozilla.org/en-US/docs/Web/API/ScrollTimeline) lie une animation directement à une source de scroll ; elle est détectée explicitement car son support varie selon les moteurs. Le premier passage à deux rails synchronisés est remplacé par cette source unique. Supprimer aussi le rebond horizontal du corps afin de conserver l'alignement aux limites de la course.

## Density and delivery

Decision finale : padding vertical égal de 8 px au pointeur, titre/menu 24 px avec zone réelle du menu étendue à 32 px ; carte courte 42 px et hauteur liée aux lignes. Cibles 44 px et padding adapté au tactile. Même source CSS et tokens. Preuves réelles privées ; déploiement isolé Web seul. Les suites/matrices restent suspendues à la demande du propriétaire.
