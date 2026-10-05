# Feature Specification: Revue complète et composants communs de l’application

**Feature Branch**: `codex/033-app-ui-review`
**Created**: 2026-10-03
**Status**: Passe initiale fusionnée ; corrections de maintenance vérifiées, en attente de relecture du propriétaire
**Input**: « Commit en l’état, passe complète sur l’app ; composants génériques réutilisables si cohérents, sans casser les interfaces. »

## Direction produit et périmètre

Canevas §§4, 7–22, 24, 26–33, 38–39, 43.4–43.6, 46. Suite de 031/032 :
étendre la revue aux familles implémentées et surfaces conditionnelles (conflits,
récupération, historique, fichiers, formats de base et menus). Le renderer
desktop partagé est inclus ; packaging et chrome natif OS restent hors périmètre.
Les fonctions futures ou réservées au terminal n’ajoutent pas d’écran.

## User Scenarios & Testing

### User Story 1 — Parcourir une application uniforme (Priority: P1)

Retrouver les mêmes repères, y compris lors d’erreur, attente ou décision rare.
**Why this priority**: Les états rares ne doivent pas ramener un autre style.
**Independent Test**: Inventaire des surfaces courantes/conditionnelles, revue
clair/sombre, 320/1280 px, actions sensibles sur exemples isolés.

**Acceptance Scenarios**:
1. **Given** les familles implémentées, **When** la revue finit, **Then** chacune
   possède un résultat/preuve, ou une exclusion motivée pour du code inutilisé.
2. **Given** conflit/fichier/révision, **When** il apparaît, **Then** contenu
   lisible, actions accessibles et aucun débordement du document à 320 px.
3. **Given** attente/erreur/vide, **When** il apparaît, **Then** il reste neutre,
   contextualisé avec reprise locale et géométrie stable.

### User Story 2 — Réutiliser les composants communs (Priority: P1)

Construire les futures interfaces avec des composants documentés et cohérents.
**Why this priority**: Éviter les variantes contradictoires sans casser les parcours.
**Independent Test**: Comparer usages réels de boutons, formulaires, dialogues,
menus, tableaux et états ; essayer les compositions du laboratoire.

**Acceptance Scenarios**:
1. **Given** un rôle partagé, **When** il est harmonisé, **Then** il réutilise un
   composant commun ou une exception de domaine motivée, sans bibliothèque parallèle.
2. **Given** un contrôle remplacé, **When** clic/clavier/Échap, **Then** action,
   focus, saisie, busy/disabled et récupération restent conservés.
3. **Given** tableau éditorial ou de base, **When** les communs évoluent,
   **Then** sélection, édition et géométrie spécialisée restent intactes.

### User Story 3 — Observer et reprendre le travail (Priority: P2)

Observer sur l’instance courante et disposer de règles réellement vérifiées.
**Independent Test**: App/lab accessibles ; guide, inventaire et contrôles consultables.
**Acceptance Scenarios**:
1. **Given** 032 enregistré, **When** la passe commence, **Then** sa référence Git
   reste identifiable et les corrections sont séparées.
2. **Given** données actuelles de dev, **When** les sources changent, **Then**
   elles restent conservées et l’instance utilise ce répertoire.

### Edge Cases

- Texte long/préformaté, fichiers/options, plusieurs colonnes, menus imbriqués.
- Clavier/tactile/mouvement réduit, hors ligne, récupération et erreurs.
- Code historique non monté : exclusion explicite, pas de faux rendu vérifié.
- Formats de base/propriétés typées/source indisponible.

## Requirements

### Functional Requirements

- **FR-001** : Conserver référence du commit initial et données de dev.
- **FR-002** : Inventorier familles et surfaces conditionnelles implémentées ;
  distinguer revue réelle, exemple du composant réel et code inutilisé.
- **FR-003** : Corriger différences de contrôles, titres, espacement et états
  constatées ; conserver densités/interfaces de domaine intentionnelles.
- **FR-004** : Consolider les génériques effectivement partagés ; documenter
  leur emploi/exceptions avec exemples exécutables.
- **FR-005** : Préserver interactions, saisies, focus et données ; aucune
  suppression/restauration/rotation réelle pour obtenir une preuve.
- **FR-006** : Vérifier clair/sombre, 320/1280 px, clavier et cibles tactiles
  sur surfaces corrigées ; scroll local des contenus larges.
- **FR-007** : Accents #4481D8/#D56C5E, palette de contenu conservée, focus
  discret visible, attente neutre, suppression neutre à texte/contour rouges.
  Les textes et remplissages d'action utilisent des variantes sémantiques
  contrastées dans chaque thème, sans changer la palette des propriétés.
- **FR-008** : Instance, preuves, tâches et guide reflètent la passe. Après la
  sauvegarde de l’état UI validé, toutes les suites unitaires et E2E sont remises
  en cohérence avec les parcours actuels. Les contrôles locaux complets puis la
  CI de la PR doivent réussir pour cette passe applicative ; les données de dev
  sont préservées. Les suites suivantes sélectionnent leurs contrôles selon
  l'impact réel : une correction délimitée reçoit ses tests pertinents, une
  modification transversale ou incertaine une validation complète, et un suivi
  documentaire sans impact exécutable les contrôles de documents uniquement.
  Les preuves applicatives réussies restent réutilisables lorsque le code et
  ses entrées exécutables sont inchangés ; la CI requise bloque toujours la fusion.
- **FR-009** : La liste de pièces jointes de la sidebar suit
  les fichiers/images intégrés au contenu local courant, y compris imbriqués,
  sans doublon ni bouton d'ajout indépendant. Les fichiers historiques sans
  bloc restent conservés mais ne sont pas listés. Les lignes utilisent le
  trombone et un retrait plus léger ; contenu indisponible, vide et erreur
  restent distincts.
- **FR-010** : Le titre d'une ligne d'arbre cède la place à la largeur réelle
  des actions révélées et du groupe « + », avec ellipsis pendant ouverture et
  fermeture, y compris avec la commande Base de données. Les contrôles restent
  contenus dans la ligne, utilisables au clavier et au tactile.
- **FR-011** : Tant que les pièces jointes sont ouvertes, le trombone, « + » et
  « … » restent visibles même après une interaction ailleurs. Les compteurs
  du trombone et de l'en-tête restent présents mais petits et discrets, sans
  masquer l'icône ni agrandir ses contrôles (clarification du propriétaire :
  « trop gros », et non « de trop »). L'ouverture et la fermeture,
  y compris en quittant la page, restent fluides sans réaffichage inutile des
  éditeurs ouverts ; contenu, saisie et historique restent conservés.
  Ouvrir les PJ d'une autre page reste une inspection dans la sidebar : cela
  ne change ni la page active ni ses onglets. Les panneaux peuvent être
  ouverts indépendamment et se ferment
  lors d'une navigation réelle vers une autre page ou le graphe.
- **FR-012** : Déplacer un bloc par sa poignée à six points affiche un trait
  bleu à la destination valide, aligné sur la colonne de l'éditeur actif, même
  avec d'autres onglets conservés et masqués. La preview suit la destination
  réellement utilisée au dépôt, disparaît à l'annulation/fin du geste et ne
  modifie pas le contenu avant dépôt. Les destinations interdites n'affichent
  pas de faux repère ; mentions et tableaux conservent leurs déplacements.
- **FR-013** : La poignée à six points possède une surface rectangulaire qui
  suit les proportions du dessin. L'espace visible entre les points et chacun
  des quatre bords est identique, en conservant le retrait supérieur actuel.
  Un léger intervalle sépare le bouton du texte. Survol, focus, menu et
  glisser conservent cette géométrie, les commandes et le contenu du bloc.
- **FR-014** : L'ajout et la poignée du bloc sont centrés face à sa première
  ligne de texte visible, en tenant compte des espacements des titres et de
  leur taille réelle. Un titre sur plusieurs lignes n'aligne pas les boutons
  sur le centre de tout le titre. Titres vides, changement de largeur et
  hauteur tactile des contrôles conservent un placement prévisible.

- **FR-015** : La poignée de largeur d'une colonne reste transparente au repos,
  survol, focus et pendant le geste. Seul le trait bleu indique son activation ;
  sa zone de prise et les commandes clavier restent opérationnelles.
- **FR-016** : Une page ou un dossier entrée de base garde l'en-tête, le titre
  éditable, l'icône, le chemin et la colonne de lecture des autres pages. Les
  propriétés apparaissent en lignes compactes sous le titre, avec libellés
  discrets et pastilles identiques à celles des vues. Le document ou les enfants
  suivent sans second titre de page ni intitulé de formulaire technique.
  Les brouillons, erreurs locales, propriétés indisponibles sont conservés. La sauvegarde automatique décrite
  par FR-017 remplace le bouton explicite précédent. Références du propriétaire :
  [ligne](assets/notion-entry-row.png), [page](assets/notion-entry-page.png).

- **FR-017** : Les valeurs d’une entrée s’enregistrent automatiquement : choix et
  cases immédiatement, saisie après une courte pause, à la sortie du champ ou
  Entrée. Aucun bouton Enregistrer. Les saisies pendant une écriture ne sont
  pas perdues, les modifications non concernées sont conservées et les erreurs
  gardent le brouillon avec Réessayer. Le succès annonce seulement la durabilité
  locale, jamais une synchronisation certaine.
- **FR-018** : Clic normal, clic droit et clavier sur un libellé de propriété
  ouvrent directement le panneau de modification (nom, icône, type, options,
  duplication, suppression, déplacement). Ce même panneau sert sur la page
  d’entrée et dans la liste des propriétés des réglages de vue. Il n’y a pas
  d’étape intermédiaire « Renommer » ou « Modifier ». Le sélecteur de valeurs
  permet de chercher/créer une option et de modifier son nom/couleur. Ajouter
  une propriété est disponible sous les lignes. Les opérations destructives
  conservent la confirmation d’impact et la récupération existantes ; aucune
  commande fictive de commentaire, IA ou permissions n’est ajoutée.
- **FR-019** : Chaque propriété possède une poignée à six points révélée au
  survol/focus, pour changer son ordre par glisser ou clavier. Un trait bleu
  indique la destination ; une seule écriture au dépôt, aucune à l’annulation.
  L’ordre est celui des propriétés des pages de la même source ; l’ordre des
  colonnes de chaque vue reste indépendant. Les rôles de tâches et valeurs
  gardent leur identité après le déplacement.

- **FR-020** : Une propriété de source peut recevoir ou retirer une icône via
  le même catalogue de symboles que les vues (recherche, sélection, retour au
  symbole du type). Une page peut choisir un emoji ou un de ces symboles ; une
  propriété ou une icône de vue ne peut recevoir qu’un symbole.
  Le choix s’enregistre automatiquement et se retrouve dans les entrées, en-têtes
  et affichages de propriétés de toutes les vues. Il reste après renommage,
  déplacement, duplication et changement de type ; ces actions conservent leurs
  protections propres. Les anciennes propriétés sans icône restent utilisables.

- **FR-021** : Dans le choix d’une propriété, les options sélectionnées et la
  recherche partagent un seul champ neutre. Chaque croix reste à l’intérieur de
  sa pastille colorée ; elle retire seulement cette valeur de l’entrée et rend
  le focus à la recherche. Un libellé long ne masque pas la croix ; plusieurs
  choix se répartissent dans le champ sans débordement. Les recherches d’icônes
  et de propriétés utilisent les mêmes repères de saisie et de focus discret.
  Recherche vide, sans résultat, clavier et tactile restent opérationnels.

### Retours de maintenance — 2026-10-04

- **FR-022** : Les réglages restent visibles au pied de la sidebar ouverte,
  même avec une longue branche dépliée. Le contenu de navigation défile dans
  l'espace restant, sur bureau et dans le tiroir mobile, sans dépasser le cadre.
- **FR-023** : Lorsque le changement de source d'une vue est interdit, « Source »
  est grisée et inactive dès le menu de l'onglet (clic/clic droit) et dans les
  paramètres. Le contrôle indique « Ajoutez une deuxième vue pour changer sa
  source ». Dès que le verrou existant est levé, les deux accès sont actifs.
  La gestion des sources reste distincte et les vues liées gardent leurs règles.

### Key Entities

- **Surface** : famille, composant, état et accès réel ou exemple isolé.
- **Contrat commun** : rôle, interactions et variations de domaine admises.
- **Preuve** : rendu, dimensions, thème, contrôle et résultat associé.

## Success Criteria

### Measurable Outcomes

- **SC-001** : 100 % des familles/surfaces conditionnelles inventoriées ont un
  résultat ; aucune surface active exclue faute de données.
- **SC-002** : Aucun débordement du document à 320 px sur surfaces revues ;
  tableaux/code larges défilent localement.
- **SC-003** : Chaque correction commune a deux usages réels ou un besoin
  partagé identifié, documentés/vérifiés sans régression connue.
- **SC-004** : Défauts matériels observés corrigés avant clôture, avec preuves
  et contrôles locaux consultables.
- **SC-005** : App/exemples accessibles sur l’instance courante, données conservées.

## Assumptions

- Retour du propriétaire : les propriétés proposent le même choix d’icônes que
  les vues. Le choix et son retrait s’enregistrent automatiquement dans la source,
  sans modifier type, options ou valeurs ; l’absence de choix garde le symbole
  du type. Voir FR-020 et T033–036.

- La bibliothèque existante est la base ; pas d’abstraction arbitraire des
  modèles métier des tableaux, éditeur ou graphe.
- Revue complète des capacités implémentées/états distincts, pas des fonctions
  futures ni de toutes les combinaisons de données possibles.
- Le 2026-10-03, le propriétaire lève le report des E2E et autorise la publication
  de la branche et l’ouverture d’une PR, avec correction jusqu’à une CI verte.
  Les anciennes notes « sans E2E » décrivent les étapes précédentes uniquement.
