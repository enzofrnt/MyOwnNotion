# Feature Specification: Expérience V1 proche de Notion et convergence locale

**Feature Branch**: `codex/017-v1-notion-like-workspace`

**Created**: 2026-08-20

**Status**: Ready for Tasks

**Input**: User description: "Rendre obligatoire dans la V1 une interface
qualitative et fonctionnelle proche de Notion. Reprendre proprement le shell,
la barre latérale et l'éditeur par blocs avec menus contextuels, barre d'outils
flottante, glisser-déposer, interactions avancées et design cohérent, tout en
réutilisant les fondations d'édition déjà livrées. Corriger également la
restauration de scroll et le cas clavier WebKit encore ouverts dans la feature
003. Garantir aussi que le même propriétaire puisse modifier la même page sur
plusieurs appareils hors ligne, puis retrouver automatiquement un contenu
convergent sans remplacement du document entier ni perte silencieuse."

> **Répartition active (2026-08-25)** — La feature
> [018](../018-durable-realtime-sync/spec.md) spécialise et remplace la mise en
> œuvre du transport éditorial temps réel, de la reprise des profils hérités,
> des limites de session, de la révocation active, du statut fichier et de la
> continuité après restauration. Les exigences produit de convergence restent
> valides ici ; leur preuve technique vit désormais dans la 018. Une fois cette
> fondation validée, la 017 reprend à US7/US6 et aux tâches UI/éditeur encore
> ouvertes, sans reconstruire un second transport.

## Product Direction, Dependencies, and Scope

Cette feature concrétise les sections 3, 6.1, 7, 9 à 21, 28 à 32 et 42 à 47 du
[canevas produit](../../docs/product/product-canvas.md). La vision y promet déjà
une organisation et une édition proches de Notion, mais le périmètre V1 ne
rendait pas encore leur niveau d'interaction et de finition vérifiable. Cette
feature ferme cet écart : la V1 ne peut plus être annoncée comme terminée tant
que ses parcours cœur restent une juxtaposition de contrôles techniques plutôt
qu'un espace de travail cohérent.

Les features précédentes restent propriétaires de leurs données et garanties :
modèle canonique et hors-ligne (001), sécurité (002), éditeur et navigation de
base (003), conversion page/dossier (004), fichiers (005), transport,
autorisation des appareils et rattrapage (006), sauvegarde et restauration
(007), recherche (008), bases et tâches structurées (009). La 017 remplace leur
présentation et enrichit leurs interactions.

Cette feature affine toutefois délibérément deux fondations devenues
insuffisantes pour la V1. Elle remplace le bouton de sauvegarde et l'écriture du
corps complet d'une page hérités de la 003. Elle remplace aussi, pour le seul
contenu éditorial des pages, la fusion à trois voies par blocs de la 006 par une
représentation causale et convergente à la granularité du texte riche, des
blocs stables et de leurs déplacements. La file locale chiffrée, le flux de
changements, les appareils autorisés, les fichiers, les révisions et les
protections de la 006 restent réutilisés. Le modèle canonique indépendant de
l'éditeur demeure le contrat durable ; sa projection est matérialisée depuis
l'état opérationnel vérifié, et non maintenue comme une seconde vérité
concurrente.

Le périmètre obligatoire couvre l'ensemble du produit visible dans la version
livrée : installation initiale, connexion, workspace, barre latérale, pages,
éditeur, fichiers, recherche, bases déjà présentes, sauvegardes, sécurité,
états hors ligne et conflits. « Proche de Notion » désigne ici un modèle
d'interaction mesurable et une qualité cohérente ; cela ne signifie ni copie
pixel par pixel, ni parité avec toutes les fonctions de Notion.

La cohérence ne signifie pas réunir toutes ces fonctions sur la page courante.
Le workspace principal est réservé aux contenus et vues de connaissance ; les
réglages, sauvegardes, appareils, stockage, sécurité et diagnostics détaillés
ouvrent des surfaces dédiées. Seuls des états compacts et actionnables peuvent
rester dans le chrome du contenu.

Cette feature absorbe les deux écarts connus de la 003 : restauration de la
position dans un document et déplacement clavier vers le parent sur WebKit.
Elle ne rouvre pas l'historique des tâches terminées de la 003 ; elle prend la
responsabilité explicite de ces comportements dans son propre périmètre.

## Référence d’interaction versionnée

La maquette validée
[sidebar-attachments-v3.html](assets/sidebar-attachments-v3.html) est la
référence normative de la tranche « barre latérale, ligne d’arbre et pièces
jointes ». Elle conserve directement les états ouverts et fermés, l’ordre des
commandes, les raccords de surfaces, les icônes et les mouvements approuvés.
Les exigences ci-dessous rendent ces attentes testables, mais ne peuvent pas
être interprétées comme une réduction de la maquette. Lorsqu’un détail de ce
périmètre est ambigu dans la prose, le comportement observable de cette
référence fait autorité. Une évolution différente exige donc une nouvelle
validation explicite et une mise à jour simultanée de la référence, de la spec,
du plan et des tests concernés.

## Clarifications

### Session 2026-08-20

- Q: Une interface seulement fonctionnelle suffit-elle à déclarer la V1 ? → R:
  Non. La V1 doit posséder une interface cohérente, qualitative et réellement
  utilisable selon un modèle d'interaction proche de Notion.
- Q: La qualité Notion-like doit-elle être ajoutée rétroactivement à la feature
  003 ? → R: Non. La 003 reste la fondation livrée ; la convergence visuelle et
  interactive devient une feature V1 dédiée et vérifiable.
- Q: Une dépendance commerciale ou un service d'édition externe peut-il devenir
  obligatoire pour écrire ? → R: Non. Le parcours essentiel doit rester
  redistribuable avec l'application, auto-hébergé, utilisable hors ligne et
  remplaçable.
- Q: Deux appareils du propriétaire peuvent-ils modifier hors ligne la même
  page, voire le même paragraphe, puis se resynchroniser sans choisir une
  version complète ? → R: Oui. Les caractères, marques, blocs et déplacements
  compatibles doivent converger automatiquement, quel que soit l'ordre de
  réception ou le nombre de nouvelles tentatives.
- Q: Dans quels cas une décision manuelle reste-t-elle acceptable ? → R:
  Uniquement quand deux intentions ne peuvent pas être satisfaites ensemble,
  notamment suppression contre édition ou déplacement. Les deux intentions et
  leur contenu récupérable doivent alors rester conservés jusqu'à résolution.
- Q: Une sauvegarde du document complet reste-t-elle le chemin normal
  d'édition ? → R: Non. Chaque transaction éditoriale est d'abord durable
  localement, puis synchronisée comme mise à jour causale incrémentale. Le
  document canonique complet devient une projection vérifiée pour lecture,
  export, recherche, historique et sauvegarde.
- Q: Une longue absence autorise-t-elle le serveur à oublier un appareil encore
  autorisé ? → R: Non. Le temps seul ne doit pas invalider ses changements ;
  seule une révocation explicite permet de cesser de retenir sa frontière de
  synchronisation.

### Session 2026-08-24

- Q: Le workspace principal peut-il afficher sous la page les panneaux de
  stockage, révisions, corbeille, sécurité, sauvegardes ou diagnostics ? → R:
  Non. Comme dans Notion ou Obsidian, cette surface est consacrée aux pages,
  dossiers, contenus et vues de connaissance. Les fonctions de configuration
  ou d'exploitation ouvrent une surface dédiée ; seul un statut compact utile
  à l'action immédiate reste près du contenu et mène vers son détail.
- Q: Une page historique ouverte dans l'éditeur alors que le serveur est
  joignable doit-elle d'abord passer par une branche locale de compatibilité ?
  → R: Non. Après drainage d'une éventuelle écriture historique déjà durable,
  l'ouverture éditable active atomiquement l'état opérationnel courant avant
  d'accepter le premier geste. Une branche sémantique locale n'est créée que
  si la page possède déjà des gestes hors ligne à préserver ou si le serveur
  est réellement indisponible.

### Session 2026-08-27

- Q: Favoris et Récents doivent-ils rester affichés en permanence ? → R: Non.
  Chaque section peut être repliée depuis la barre latérale et masquée ou
  réaffichée depuis les réglages ; ces choix de présentation restent locaux à
  l'appareil et ne modifient pas les contenus concernés.
- Q: Comment un dépôt dans l'arborescence choisit-il entre réordonner et
  imbriquer ? → R: La position visée fait autorité : avant, à l'intérieur ou
  après. Un repère entre les lignes matérialise un réordonnancement, tandis que
  la ligne entière matérialise une imbrication possible.
- Q: Quand une page sans titre reçoit-elle son libellé de repli ? → R:
  Seulement après avoir quitté l'édition du titre. Un champ ciblé peut rester
  vide sans qu'un délai réinjecte « Sans titre » pendant la frappe.
- Q: Quelles actions sont obligatoires sur un lien existant ? → R: Ouvrir,
  modifier et retirer le lien, pour une cible interne comme externe, depuis un
  outil contextuel et le clic droit. Retirer la référence conserve son texte et
  ne touche jamais à la page cible.
- Q: Où placer l'état compact de synchronisation ? → R: Au bord inférieur du
  contenu visible, hors du flux du document, avec un détail au survol, au focus
  ou au clic et sans déplacement du texte lorsque son état change.
- Q: Comment présenter les contrôles de repli des raccourcis et de l'arbre ? →
  R: Favoris et Récents utilisent un chevron compact immédiatement avant leur
  libellé. Une branche utilise le même symbole mais dans l'emplacement de son
  emoji ou de son icône, sans glyphe textuel isolé ni commande rejetée à
  l'autre extrémité du titre.
- Q: Que devient une page dont le dernier enfant vient d'être déplacé ? → R:
  Elle redevient immédiatement une feuille normale : son ancien état ouvert ne
  rend aucun message vide. Un dossier explicitement ouvert peut encore
  expliquer qu'il est vide.
- Q: Liens Web, liens de page et contenus intégrés partagent-ils la même
  action ? → R: Non. « Lien vers une page » ouvre une recherche compacte de
  pages et dossiers ; « Lien Web » ouvre une saisie compacte d'adresse et
  produit un bookmark pleine largeur. Les contenus intégrés interactifs
  restent une troisième action explicite. Aucun parcours ne demande au
  propriétaire de deviner quel type sera créé après validation.
- Q: Un lien interne possède-t-il un texte ou une icône indépendants de sa
  cible ? → R: Non. Il conserve l'identité canonique de la page ou du dossier,
  affiche toujours son titre courant et reprend son emoji ou son icône par
  défaut. Son libellé n'est pas éditable. Une référence explicite porte un
  petit indicateur de lien ; la référence créée par `/page` vers l'enfant
  direct de la page courante n'en porte pas.
- Q: À quel objet appartient l'emoji affiché dans l'interface ? → R: À la page
  ou au dossier lui-même, jamais au lien qui le représente. Cette propriété
  canonique facultative contient un seul grapheme emoji Unicode et se retrouve
  dans l'arborescence, l'en-tête de page, la recherche et toutes les
  représentations de cette identité. L'absence d'emoji utilise l'icône de type
  existante.
- Q: Où le chevron d'une branche apparaît-il par rapport à son icône ? → R:
  Dans le même emplacement fixe. Lorsqu'une branche est ciblée au pointeur ou
  au clavier, le chevron remplace visuellement l'emoji ou l'icône sans ajouter
  de colonne ni déplacer le libellé. Une feuille ne matérialise aucun chevron.
- Q: Que doit-il se passer après avoir supprimé tout le texte d'un lien ? → R:
  Le lien disparaît avec son dernier caractère et la saisie suivante est du
  texte normal. Le curseur reste visiblement clignotant sur tout bloc vide ou
  nouvelle ligne active.

### Session 2026-08-28 — navigation validée

- Q: Faut-il conserver une poignée à six points devant chaque élément de
  l'arborescence ? → R: Non. Toute la ligne d'une page ou d'un dossier sert de
  prise au pointeur, tandis qu'un clic sans déplacement ouvre l'élément. Les
  poignées des blocs à l'intérieur de l'éditeur ne sont pas concernées.
- Q: Dans quel ordre apparaissent les actions contextuelles d'une page ? → R:
  De gauche à droite : la commande discrète des pièces jointes, `+`, puis `…`.
  Un dossier omet seulement la première commande. `+` ouvre, dans la ligne et
  sans en modifier la géométrie, les deux choix explicites « nouvelle page » et
  « nouveau dossier » ; il tourne alors en croix et appartient à la même
  surface arrondie que ces choix.
- Q: Comment les pièces jointes se déplient-elles depuis l'arborescence ? → R:
  Comme une continuation compacte de la ligne sélectionnée, de même largeur et
  sans changer sa hauteur ni sa position. La surface affiche son titre et son
  nombre, puis soit des lignes de fichiers compactes, soit une unique ligne
  « Aucune pièce jointe ».
- Q: Quel mouvement est attendu pour les sous-éléments et les panneaux en
  ligne ? → R: Ouverture et fermeture utilisent la même transition courte et
  progressive. Une surface repliée ne conserve ni espace résiduel ni contenu
  interactif accessible.
- Q: L'identité d'un dossier doit-elle être modifiable uniquement depuis son
  menu ? → R: Non. Ouvrir un dossier affiche dans la zone principale le même
  éditeur d'identité que pour une page : emoji canonique et grand titre
  modifiable, sans créer un deuxième modèle de données.
- Q: La maquette de navigation validée est-elle seulement illustrative ? → R:
  Non. Le fichier `assets/sidebar-attachments-v3.html` est versionné avec la
  feature et constitue la référence d’acceptation de cette tranche ; la
  traduction Speckit ne doit ni en perdre ni en simplifier les interactions.
- Q: La barre latérale peut-elle être masquée sur un écran large ? → R: Oui.
  Une commande dans son en-tête la replie entièrement avec un mouvement court,
  le contenu récupère progressivement l’espace, puis une commande persistante
  dans le coin supérieur du contenu permet de la réafficher. Le choix reste
  local à l’appareil et survit au rechargement.
- Q: Comment matérialiser précisément le dépliage d’une branche ? → R: Le même
  chevron orienté vers la droite tourne progressivement de 90 degrés. Il
  remplace l’emoji au survol ou au focus dans une petite surface réactive ; les
  descendants apparaissent et disparaissent progressivement, sans saut ni
  espace résiduel.
- Q: Jusqu’où la surface de création enfant peut-elle se déployer ? → R: Elle
  reste intégrée dans les limites verticales et droites de la ligne active. Elle
  peut recouvrir temporairement la fin du titre vers la gauche et la commande
  discrète des pièces jointes lui cède sa place, mais aucun contrôle ne déborde
  visuellement de la ligne. Le groupe ouvert est une enveloppe compacte et
  visible, avec sa propre teinte et ses arrondis, qui contient réellement trois
  commandes — page, dossier, même `+` devenu croix. Cette enveloppe reste plate,
  sans ombre extérieure ni lecture de popover détaché ; une respiration
  régulière d’un pixel l’entoure et sépare ses commandes.
- Q: Quelle commande et quel mouvement représentent les pièces jointes ? → R:
  Un trombone discret, identique à la maquette. Le panneau raccordé sous la
  ligne gagne et perd progressivement sa hauteur et son opacité ; il ne surgit
  jamais en un seul rendu.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Entrer dans un espace de travail focalisé (Priority: P1)

En tant que propriétaire, j'arrive dans un espace organisé autour d'une barre
latérale et d'un contenu principal. Je retrouve immédiatement mes pages, ma
recherche et l'état de mon travail sans être confronté à une succession de
panneaux techniques et de boutons permanents.

**Why this priority**: Le shell détermine chaque parcours. Tant que navigation,
création et contenu se disputent la même colonne, même un éditeur riche reste
difficile à utiliser.

**Independent Test**: Depuis un workspace contenant une hiérarchie, des
favoris et des éléments récents, ouvrir, créer, renommer, déplacer et retrouver
une page sur ordinateur puis sur un écran de 320 pixels.

**Acceptance Scenarios**:

1. **Given** un écran large, **When** le propriétaire ouvre le workspace,
   **Then** la navigation reste dans une barre latérale distincte et le contenu
   actif occupe une surface de lecture centrée sans panneau technique imposé.
2. **Given** un téléphone ou une fenêtre étroite, **When** le propriétaire
   ouvre puis referme la navigation, **Then** elle se présente comme un panneau
   adapté au toucher, rend le focus au déclencheur et ne masque plus le contenu
   après sélection.
3. **Given** une page de la hiérarchie, **When** le propriétaire la survole, la
   cible au clavier ou ouvre son menu, **Then** les actions contextuelles sont
   disponibles sans transformer chaque ligne en rangée permanente de boutons.
4. **Given** une largeur de barre latérale, des branches ouvertes et une page
   visitée, **When** le propriétaire revient dans l'application, **Then** ce
   contexte est restauré sur l'appareil.
5. **Given** une page ouverte, **When** son titre ou son emplacement change,
   **Then** l'en-tête, le fil de navigation et la barre latérale reflètent la
   même identité sans rechargement ni perte de focus.
6. **Given** une page ou un dossier ouvert, **When** le propriétaire parcourt
   le contenu principal, **Then** aucun panneau de stockage, sécurité,
   sauvegarde, appareil, file de mutations ou diagnostic détaillé n'est rendu
   sous ce contenu ; son accès dédié restaure la même page et la même position
   au retour.
7. **Given** les sections Favoris et Récents, **When** le propriétaire les
   replie ou change leur visibilité dans les réglages, **Then** chacune répond
   indépendamment, le choix revient sur cet appareil et la hiérarchie Notes ne
   change pas.
8. **Given** une branche comprenant plusieurs niveaux, **When** le propriétaire
   vise l'espace avant une ligne, son centre ou l'espace après elle, **Then** le
   repère indique respectivement avant, à l'intérieur ou après et le résultat
   suit exactement ce repère sans cycle.
9. **Given** le titre « Sans titre » ciblé, **When** le propriétaire l'efface
   puis commence un autre titre, **Then** le champ reste vide entre ses gestes
   et le libellé de repli ne revient que s'il quitte le champ encore vide.
10. **Given** une page longue en cours d'édition, **When** son état de
    synchronisation change, **Then** le bouton d'information reste au bord
    inférieur visible sans déplacer le titre, les blocs ni la position de
    lecture.
11. **Given** les sections Favoris et Récents visibles, **When** le propriétaire
    les parcourt, **Then** chacune présente le même chevron immédiatement à
    gauche de son libellé et les réglages utilisent des interrupteurs visuels
    indiquant clairement leur état activé ou désactivé.
12. **Given** une page ouverte dans l'arborescence qui perd son dernier enfant,
    **When** le déplacement est confirmé, **Then** elle redevient une ligne
    feuille sans chevron ni message vide sous elle, et sa sélection reste
    lisible sans barre d'accent verticale.
13. **Given** un workspace sur écran large, **When** le propriétaire masque la
    barre latérale depuis son en-tête, **Then** elle disparaît progressivement,
    le contenu récupère toute la largeur et une commande du contenu permet de
    la réafficher avec retour de focus ; le même état revient après rechargement.
14. **Given** une branche fermée, **When** le propriétaire cible puis active son
    chevron, **Then** l’emoji cède sa place sans déplacement du titre, le même
    chevron tourne progressivement vers le bas et les descendants gagnent leur
    hauteur progressivement ; la fermeture produit le mouvement inverse.
15. **Given** une ligne de page sélectionnée, **When** le propriétaire ouvre la
    création enfant, **Then** page, dossier et croix forment une seule surface
    dans la ligne, sans modifier le rectangle de la ligne ni dépasser de ses
    limites supérieure, inférieure ou droite.
16. **Given** une page sélectionnée avec ou sans fichier, **When** le
    propriétaire active le trombone, **Then** une continuation de même largeur
    s’ouvre progressivement sous la ligne sans modifier celle-ci et présente
    soit les fichiers compacts, soit l’unique état vide validé.

---

### User Story 2 - Écrire et manipuler des blocs naturellement (Priority: P1)

En tant que propriétaire, je peux rester dans le texte et faire apparaître les
outils au moment où ils sont utiles : insertion à la position du curseur,
poignée sur le bloc actif, menu contextuel, barre de formatage sur la sélection
et glisser-déposer avec destination visible.

**Why this priority**: C'est le cœur de la promesse Notion-like. Une barre de
nombreux boutons au-dessus du document expose les capacités, mais ne fournit
pas une expérience d'écriture fluide.

**Independent Test**: Créer un document vide, insérer et transformer des blocs
par cinq chemins différents, en déplacer plusieurs, formater une sélection,
annuler, rétablir, recharger et comparer le document obtenu.

**Acceptance Scenarios**:

1. **Given** un bloc vide ou une position entre deux blocs, **When** le
   propriétaire utilise `/`, le bouton d'ajout, le clic droit, le clavier ou le
   glisser-déposer, **Then** le nouveau bloc apparaît à cette position et le
   focus rejoint son contenu.
2. **Given** un bloc ciblé, **When** le propriétaire utilise sa poignée,
   **Then** il peut le déplacer, le transformer, le dupliquer ou le supprimer,
   avec une alternative clavier portant les mêmes actions.
3. **Given** du texte sélectionné, **When** le propriétaire applique une mise
   en forme depuis la barre flottante, **Then** la sélection et la position de
   lecture restent stables et l'action est annulable.
4. **Given** plusieurs blocs sélectionnés, **When** le propriétaire les déplace
   ou les supprime, **Then** l'ordre relatif du groupe est préservé et une seule
   annulation restaure l'ensemble.
5. **Given** une destination interdite ou devenue indisponible, **When** un
   déplacement est tenté, **Then** le document reste inchangé et le refus est
   compréhensible.
6. **Given** un lien interne existant, **When** le propriétaire le survole, le
   cible ou ouvre son menu contextuel, **Then** il peut l'ouvrir, choisir une
   autre page ou retirer seulement la référence ; son libellé et son icône
   restent ceux de la cible et ne sont pas éditables indépendamment.
7. **Given** un curseur dans le document, **When** le propriétaire choisit
   « Lien vers une page », **Then** une petite recherche ciblée lui permet de
   filtrer par nom ou chemin et de choisir au clic ou avec les flèches puis
   Entrée, sans afficher de champ Web ni créer de contenu intégré.
8. **Given** un curseur dans le document, **When** le propriétaire choisit
   « Lien Web », **Then** une petite saisie refuse toute adresse invalide et
   crée après validation un bookmark stable occupant sa propre ligne, sans
   proposer de cible interne.
9. **Given** un lien dont tout le texte vient d'être effacé, **When** le
   propriétaire continue à écrire sur cette ligne, **Then** le nouveau texte
   n'hérite pas de l'ancien lien et le curseur reste visible sur la ligne vide.

---

### User Story 3 - Composer une page riche sans quitter l'éditeur (Priority: P1)

En tant que propriétaire, je peux composer une vraie page de connaissance avec
texte riche, listes imbriquées, tâches, citations, code, sections repliables,
encadrés, tableaux simples, liens internes, images, fichiers et contenus
intégrés, tout en conservant les garanties de fichiers et d'export existantes.

**Why this priority**: Une apparence Notion-like qui ne permettrait que les
blocs minimaux de la 003 resterait une démonstration visuelle, pas un outil de
travail V1 complet.

**Independent Test**: Produire une page contenant chaque bloc et mise en forme
obligatoire, la consulter hors ligne, l'exporter, la rouvrir sur un autre
appareil puis vérifier contenu, ordre et références.

**Acceptance Scenarios**:

1. **Given** une page, **When** le propriétaire utilise les mises en forme
   courantes, **Then** gras, italique, souligné, barré, code en ligne, liens,
   couleur de texte et surlignage peuvent coexister sans créer un contenu
   impossible à exporter.
2. **Given** un bloc, **When** il est transformé entre les types compatibles,
   **Then** son texte et ses enfants compatibles sont conservés et toute perte
   nécessaire est annoncée avant confirmation.
3. **Given** un fichier ou une image locale, **When** il est déposé ou collé
   dans la page, **Then** il suit le cycle de vie, la disponibilité hors ligne,
   les limites et les protections des fichiers existants.
4. **Given** une section repliable, une liste ou un tableau, **When** le
   propriétaire navigue uniquement au clavier, **Then** chaque contenu et
   commande reste atteignable sans piège de focus.
5. **Given** un lien interne, **When** sa cible est renommée, déplacée,
   convertie ou momentanément indisponible, **Then** l'identité canonique reste
   intacte et l'état de la cible est expliqué.

---

### User Story 4 - Reprendre exactement où le travail s'est arrêté (Priority: P1)

En tant que propriétaire, je peux quitter une longue page, naviguer ailleurs,
fermer brutalement l'application ou perdre le réseau, puis reprendre sans
chercher ma position et sans douter de la sécurité de mes modifications.

**Why this priority**: La qualité perçue ne vaut rien si elle affaiblit les
garanties local-first ou si une refonte fait mentir l'état de sauvegarde.

**Independent Test**: Modifier une page longue, mémoriser une position,
interrompre successivement la navigation, le réseau et le processus, puis
revenir et vérifier position, contenu, curseur et état de sauvegarde.

**Acceptance Scenarios**:

1. **Given** une position dans une page longue, **When** le propriétaire ouvre
   une autre page puis revient, **Then** la position précédente est restaurée
   au voisinage du même contenu sans saut tardif.
2. **Given** une modification locale non envoyée, **When** l'application est
   fermée brutalement puis relancée, **Then** la modification réapparaît et son
   état n'est jamais présenté comme synchronisé avant confirmation.
3. **Given** une perte de réseau, **When** le propriétaire continue d'écrire,
   de réordonner ou de formater des blocs disponibles localement, **Then** les
   opérations restent locales, durables et clairement en attente.
4. **Given** une écriture refusée ou un conflit, **When** l'interface se met à
   jour, **Then** la saisie en cours reste accessible et les choix de reprise
   existants ne sont pas cachés par la nouvelle présentation.

---

### User Story 5 - Travailler hors ligne sur plusieurs appareils puis converger (Priority: P1)

En tant que propriétaire, je peux emporter mon ordinateur et ma tablette sans
réseau, modifier la même page sur les deux pendant aussi longtemps que
nécessaire, puis reconnecter les appareils dans n'importe quel ordre. Les
changements compatibles se combinent automatiquement ; une décision ne m'est
demandée que lorsque mes deux intentions s'excluent réellement, et aucun texte
n'est alors perdu.

**Why this priority**: Mono-utilisateur ne signifie pas mono-appareil. Une
application local-first qui remplace une page complète ou demande de choisir
entre deux paragraphes après une longue déconnexion ne satisfait pas la
promesse V1.

**Independent Test**: Ouvrir une même page dans deux contextes navigateur
possédant chacun leur stockage et leur appareil autorisé, couper totalement le
réseau, exécuter des suites concurrentes de texte riche, insertion,
imbrication, déplacement et suppression, fermer l'un des contextes, puis les
reconnecter dans les deux ordres et comparer l'état final et l'historique.

**Acceptance Scenarios**:

1. **Given** deux appareils partis du même paragraphe, **When** l'un modifie le
   début et l'autre la fin hors ligne, **Then** le paragraphe final contient les
   deux modifications sans conflit manuel ni caractère perdu.
2. **Given** un bloc déplacé hors ligne sur un appareil et édité sur l'autre,
   **When** les appareils se reconnectent, **Then** le bloc conserve son
   identité, rejoint la position convergente et porte le texte édité ; l'édition
   ne peut pas migrer vers un bloc voisin.
3. **Given** des insertions et déplacements concurrents de blocs distincts ou
   imbriqués, **When** les mises à jour arrivent dans des ordres différents ou
   plusieurs fois, **Then** chaque appareil produit la même hiérarchie sans
   doublon ni cycle.
4. **Given** un bloc supprimé sur un appareil et édité ou déplacé sur l'autre,
   **When** les appareils se reconnectent, **Then** l'ambiguïté devient un
   conflit explicite dont la version supprimée, le contenu modifié et les deux
   intentions restent récupérables jusqu'à la décision du propriétaire.
5. **Given** un appareil autorisé fermé pendant une longue période avec des
   changements locaux, **When** il revient après de nombreux changements
   distants, **Then** il reprend automatiquement, transmet et reçoit seulement
   ce qui manque, puis converge sans expiration arbitraire de ses données.
6. **Given** une page ouverte et modifiée dans deux onglets ou sur deux
   appareils connectés, **When** une mise à jour distante arrive, **Then** elle
   s'intègre sans remplacer le brouillon local, déplacer l'édition sur un autre
   bloc ni annoncer trop tôt un état synchronisé.
7. **Given** une page historique encore en cours d'édition locale, **When** une
   synchronisation générale et sa première bascule opérationnelle se
   chevauchent, **Then** la bascule attend toutes les opérations locales déjà
   acceptées, reprend sur l'état actif avant d'accepter les suivantes et ne
   peut ni réinstaller un instantané antérieur ni annoncer un faux succès.
8. **Given** des opérations durables en attente sur une page qui n'est plus
   ouverte, **When** l'application redémarre ou retrouve le réseau sur une autre
   page, **Then** elle découvre et transmet automatiquement cette file sans
   obliger le propriétaire à retrouver ou rouvrir le document concerné.

---

### User Story 6 - Retrouver une application cohérente partout (Priority: P2)

En tant que propriétaire, je retrouve les mêmes règles de présentation et
d'interaction dans la recherche, les fichiers, les bases, les conflits, les
sauvegardes, la sécurité, l'installation initiale et la connexion.

**Why this priority**: Un bel éditeur entouré d'écrans techniques disparates ne
constitue pas une interface V1 qualitative.

**Independent Test**: Parcourir tous les écrans livrés, déclencher pour chacun
un état normal, vide, en chargement et en erreur, puis vérifier les mêmes
composants, la même langue, la même hiérarchie visuelle et les mêmes règles de
focus.

**Acceptance Scenarios**:

1. **Given** une action courante, **When** elle existe sur plusieurs écrans,
   **Then** son libellé, son apparence, son emplacement logique et son état
   désactivé suivent les mêmes règles.
2. **Given** un détail technique utile seulement au diagnostic, **When** le
   propriétaire utilise le parcours courant, **Then** ce détail reste derrière
   une surface secondaire et ne concurrence pas le contenu principal.
3. **Given** un thème clair, sombre ou système, **When** il est choisi, **Then**
   chaque écran et chaque menu adopte le thème sans flash illisible ni perte de
   contraste.
4. **Given** une interface réglée en français, **When** le propriétaire parcourt
   les surfaces V1, **Then** aucun fragment courant ne reste en anglais et les
   dates, nombres et raccourcis suivent la locale active.

---

### User Story 7 - Tout accomplir au clavier, au toucher et sur les navigateurs pris en charge (Priority: P1)

En tant que propriétaire, je peux utiliser les mêmes parcours essentiels au
clavier, à la souris et au toucher, quel que soit le navigateur V1 pris en
charge.

**Why this priority**: Les menus contextuels et contrôles apparaissant au
survol peuvent facilement retirer des capacités au clavier ou au toucher. Ils
ne sont acceptables que s'ils améliorent l'interface sans réduire son accès.

**Independent Test**: Exécuter les parcours de création, navigation, édition,
déplacement, recherche et résolution d'erreur sur les moteurs et largeurs pris
en charge, une fois sans pointeur puis une fois au toucher.

**Acceptance Scenarios**:

1. **Given** une branche fermée sélectionnée dans l'arbre, **When** le
   propriétaire utilise la flèche gauche sur WebKit, **Then** le focus rejoint
   son parent comme sur les autres moteurs.
2. **Given** un menu, une barre flottante ou un panneau mobile, **When** il
   s'ouvre au clavier, **Then** le focus y entre selon le motif attendu, Échap
   le ferme et le focus revient à son déclencheur.
3. **Given** un zoom à 200 %, une largeur de 320 pixels ou une préférence de
   réduction des animations, **When** le parcours cœur est exécuté, **Then**
   aucune commande ne disparaît, aucune page ne défile horizontalement et les
   animations non essentielles sont supprimées.
4. **Given** une action proposée au survol ou au clic droit, **When** aucun
   survol ni clic secondaire n'est disponible, **Then** la même action reste
   accessible au clavier et au toucher.

### Edge Cases

- Un titre, un chemin, un lien ou une ligne de code dépasse largement la
  largeur disponible.
- La hiérarchie contient des milliers d'éléments et des branches profondément
  imbriquées ; l'ouverture d'un menu ne doit pas déplacer toute la liste.
- Le document contient 500 blocs, plusieurs blocs inconnus et de grandes listes
  imbriquées.
- Une sélection traverse plusieurs types de blocs dont certains ne supportent
  pas la transformation demandée.
- Un bloc est déplacé pendant que la destination change sur un autre appareil
  ou que le réseau disparaît.
- Un menu flottant est ouvert près d'un bord, au-dessus du clavier virtuel ou
  dans un conteneur qui défile.
- Une saisie avec méthode de composition, un collage riche ou un dépôt de
  plusieurs fichiers est interrompu.
- Un média est présent dans le document mais absent, déchargé, en cours de
  transfert, refusé ou en conflit sur l'appareil courant.
- Une position de scroll enregistrée désigne un contenu supprimé ou un document
  devenu plus court.
- Deux onglets modifient la même page pendant que des contrôles contextuels sont
  ouverts.
- Deux appareils insèrent du texte au même emplacement ou appliquent des
  marques incompatibles à la même plage avant de se reconnecter.
- Un appareil déplace un bloc pendant qu'un autre déplace le même bloc, supprime
  sa destination ou édite un descendant.
- Une suppression concurrente masque un sous-arbre contenant des modifications
  qui n'ont encore jamais atteint le serveur.
- Un appareil encore autorisé revient après une longue absence alors que des
  points de contrôle ont été compactés et que le serveur a été mis à jour.
- Une restauration serveur rencontre ensuite les opérations locales plus
  récentes d'un appareil qui était hors ligne pendant la restauration.
- Une ancienne mutation de remplacement complet attend encore dans la file
  locale au moment où le protocole incrémental devient actif.
- Un client précédent comprend le document canonique mais pas le nouveau flux
  d'opérations et tente d'écrire.
- Un bloc ou une marque inconnue traverse une migration, un déplacement
  concurrent et une matérialisation du document canonique.
- Une table ou une vue structurée est plus large que le contenu principal sur
  un téléphone.
- Le thème change pendant qu'un menu ou un dialogue est ouvert.
- Une page ouverte perd son dernier enfant à la suite d'un déplacement local ou
  distant ; un identifiant encore présent dans l'état de repli ne doit pas
  matérialiser une branche qui n'existe plus.
- Une page et un site portent le même nom : chaque action conserve sa famille
  de cible et ne propose ni conversion implicite ni résultat de l'autre type.
- Une page cible est renommée, déplacée, convertie, mise à la corbeille ou
  dépourvue d'emoji pendant qu'un lien vers elle est visible.
- Une page perd son dernier enfant pendant que son icône est remplacée par un
  chevron au pointeur ou au clavier.
- Tout le texte portant un lien est supprimé, puis une composition IME, un
  collage ou une frappe commence au même emplacement.

## Requirements *(mandatory)*

### Functional Requirements

#### Workspace and navigation

- **FR-001**: L'application MUST appliquer une hiérarchie visuelle, une
  typographie, des espacements, des couleurs, des surfaces et des états
  cohérents à toutes les interfaces livrées.
- **FR-002**: Sur un écran large, le workspace MUST séparer la navigation
  latérale du contenu principal et maintenir une largeur de lecture adaptée au
  contenu courant.
- **FR-003**: Sur un écran étroit, la navigation MUST devenir un panneau
  ouvrable et refermable qui ne laisse aucun contrôle caché dans l'ordre de
  focus.
- **FR-004**: L'état ouvert, la largeur choisie, les branches dépliées et le
  dernier élément visité MUST être restaurés sur l'appareil.
- **FR-005**: Les actions d'une ligne de navigation MUST être regroupées dans
  des contrôles contextuels accessibles au pointeur, au clavier et au toucher.
- **FR-006**: Le propriétaire MUST pouvoir réordonner et déplacer une branche
  par glisser-déposer ainsi que par une alternative clavier explicite, avec une
  destination visible et sans cycle possible.
- **FR-007**: Recherche, favoris, éléments récents, réglages, sauvegardes et état
  de synchronisation MUST rester accessibles depuis la navigation sans
  concurrencer visuellement la hiérarchie principale.
- **FR-072**: Le contenu principal du workspace MUST être réservé aux pages,
  dossiers et vues de connaissance livrées. Réglages, sécurité, appareils,
  stockage, sauvegardes, corbeille administrative et diagnostics détaillés MUST
  ouvrir des surfaces dédiées et ne MUST pas être empilés sous le document
  courant. Un indicateur compact de synchronisation, conflit ou alerte peut
  rester dans le chrome s'il mène à la surface pertinente et si le retour
  restaure le contexte de lecture.
- **FR-008**: Une page ouverte MUST présenter un titre éditable en place, son
  chemin et ses actions de page sans exposer ses identifiants techniques dans
  le parcours courant.
- **FR-009**: Le retour vers une page MUST restaurer sa position de lecture au
  voisinage du même contenu, avec une solution sûre si ce contenu n'existe plus.
- **FR-010**: Navigation, renommage, déplacement, conversion et ouverture d'un
  lien interne MUST conserver l'identité et le focus utile plutôt que remonter
  arbitrairement en haut de l'application.
- **FR-074**: Après toute création réussie d'une page depuis la navigation ou
  la commande `/page`, la nouvelle page MUST devenir immédiatement la page
  active et éditable, sa branche MUST être révélée et, pour `/page`, le lien
  MUST rester présent lorsque le propriétaire revient à la page source ou la
  recharge.
- **FR-076**: La hiérarchie principale MUST porter le libellé « Notes ».
  Favoris et Récents MUST posséder chacun un contrôle de repli distinct des
  contrôles de branche, une préférence de visibilité dans les réglages et un
  état de présentation restauré localement sans modifier les données métier.
- **FR-077**: La relation parent-enfant et l'état d'une branche vide MUST être
  visuellement rattachés à leur niveau. Un dépôt au pointeur MUST distinguer
  avant, à l'intérieur et après par des repères différents, et le placement
  produit MUST dépendre de la zone visée plutôt que de la position d'origine.
- **FR-078**: Le titre ciblé MUST accepter un brouillon vide sans substitution
  différée. Si le brouillon reste vide lorsque le propriétaire quitte le champ,
  le valide explicitement ou ferme la page, il MUST alors être engagé et
  présenté comme « Sans titre » sans changer l'identité de l'élément.
- **FR-079**: L'indicateur compact de synchronisation d'une page MUST rester
  ancré au bord inférieur du contenu visible, hors du flux du document, sans
  déplacement de contenu. Son détail MUST être disponible au survol, au focus
  et au clic ; un état nécessitant une action MUST rester visible sans ouvrir
  automatiquement un panneau qui recouvre l'édition.

#### Block editing

- **FR-011**: Le propriétaire MUST pouvoir insérer un bloc par commande `/`,
  clic droit, bouton d'ajout contextuel, raccourci de type Markdown et
  glisser-déposer.
- **FR-012**: Le bloc actif MUST proposer une poignée et un ajout adjacent sans
  afficher en permanence les commandes de tous les blocs.
- **FR-013**: Le glisser-déposer de blocs MUST afficher la destination exacte,
  prendre en charge le défilement automatique et préserver l'ordre et
  l'identité des blocs déplacés.
- **FR-014**: Le menu contextuel d'un bloc MUST permettre au minimum de
  transformer, dupliquer, déplacer et supprimer le bloc, avec des états
  désactivés expliqués lorsque l'action est impossible.
- **FR-015**: Une sélection de texte MUST faire apparaître une barre de
  formatage proche de la sélection sans masquer le texte ni déplacer la page.
- **FR-016**: L'éditeur MUST prendre en charge gras, italique, souligné, barré,
  code en ligne, lien externe, lien interne, couleur de texte et surlignage.
- **FR-017**: L'éditeur MUST prendre en charge au minimum paragraphes, trois
  niveaux de titres, listes à puces et numérotées, tâches, citations, code,
  séparateurs, sections repliables, encadrés, tableaux simples, images,
  fichiers et contenus intégrés autorisés.
- **FR-018**: Le propriétaire MUST pouvoir sélectionner un ou plusieurs blocs
  contigus puis les déplacer, dupliquer ou supprimer comme une seule opération
  annulable.
- **FR-019**: Toute insertion, transformation, mise en forme, imbrication,
  duplication, suppression et réorganisation MUST être annulable et
  rétablissable dans la session.
- **FR-020**: Listes, tâches et blocs compatibles MUST pouvoir être imbriqués et
  désimbriqués au clavier sans que Tab devienne un piège de focus.
- **FR-021**: Un collage riche MUST conserver uniquement les structures et
  mises en forme représentables ; toute réduction MUST préserver le texte et
  ne jamais produire un document impossible à sauvegarder.
- **FR-022**: Les liens internes MUST conserver l'identité canonique de leur
  cible et distinguer visuellement une cible active, supprimée, indisponible ou
  inconnue.
- **FR-080**: Un lien interne ou un bookmark Web existant MUST être
  reconnaissable comme cliquable et permettre de l'ouvrir, modifier sa cible et
  retirer la référence depuis un outil contextuel ainsi que par clic droit.
  Retirer une référence interne MUST ne jamais supprimer, déplacer ou renommer
  sa page cible. Remplacer une cible interne MUST conserver une identité
  canonique plutôt qu'un titre copié.
- **FR-081**: Favoris et Récents MUST placer un chevron compact immédiatement
  avant le libellé contrôlé. Les branches MUST employer le même symbole selon
  la règle d'emplacement stable de FR-086. Les préférences de visibilité MUST
  se présenter comme des interrupteurs dont les états activé et désactivé
  restent explicites au pointeur et au clavier.
- **FR-082**: Une page sans enfant MUST être rendue comme une feuille, y compris
  si elle était ouverte avant le déplacement de son dernier enfant, et ne MUST
  afficher aucun état vide sous sa ligne. La sélection courante MUST être
  indiquée par la surface complète de la ligne sans barre, arc ou bordure
  d'accent latérale ; l'indentation et les guides discrets MUST suffire à
  expliquer les niveaux parent-enfant.
- **FR-083**: La création d'une référence interne et celle d'un lien Web MUST
  utiliser deux actions nommées et deux outils compacts distincts. Le premier
  MUST rechercher uniquement une page ou un dossier par nom ou chemin ; le
  second MUST accepter uniquement une adresse Web autorisée. Les contenus
  intégrés interactifs MUST rester une action distincte et explicite.
- **FR-084**: Un bloc vide ou une nouvelle ligne ciblée MUST toujours montrer
  un curseur de saisie visible. Lorsque le dernier caractère d'un lien est
  supprimé, son état de lien MUST être retiré avant la frappe, le collage ou la
  composition suivante afin qu'aucun texte nouveau n'hérite d'une cible
  supprimée.
- **FR-085**: Chaque page ou dossier MUST posséder une icône canonique
  facultative contenant au plus un grapheme emoji Unicode ou `null`. Cette
  icône MUST être modifiable et retirable depuis la page et les actions de
  l'élément, converger entre appareils, rester disponible hors ligne et être
  conservée par export, sauvegarde et restauration. Aucun lien ne MUST posséder
  une copie indépendante de cette icône.
- **FR-086**: L'arborescence MUST réserver un seul emplacement stable à
  l'emoji, l'icône de type et au chevron de branche. Pour un élément ayant des
  enfants, le chevron MUST remplacer visuellement l'icône lorsque la commande
  de repli est ciblée au pointeur ou au clavier, sans déplacer le libellé. Une
  feuille MUST ne rendre aucun chevron ni espace supplémentaire propre au
  dépliage. Une branche MUST conserver un unique chevron orienté vers la droite
  et le faire tourner progressivement de 90 degrés pour l’état ouvert, dans la
  même surface compacte de survol ou de focus que celle de la référence
  versionnée ; elle ne MUST pas remplacer brutalement une icône droite par une
  seconde icône basse.
- **FR-087**: Une référence interne MUST afficher dynamiquement le titre et
  l'icône actuels de sa cible et MUST interdire leur édition indépendante. Une
  référence explicite vers un autre emplacement MUST porter un indicateur de
  lien superposé à l'icône ; une référence créée par `/page` vers l'enfant
  hiérarchique direct de la page source MUST ne pas porter cet indicateur.
- **FR-088**: Un lien Web créé par l'action dédiée MUST produire un bookmark
  occupant une ligne entière. Une adresse invalide MUST être refusée avant
  création. L'indisponibilité des métadonnées distantes MUST conserver un bloc
  stable affichant au minimum l'adresse et le domaine, sans iframe ni exécution
  de contenu tiers dans le contexte de l'application.
- **FR-089**: Les sélecteurs de page, d'emoji et d'adresse Web MUST être
  entièrement utilisables au clavier avec focus initial, filtrage, flèches,
  Entrée et Échap selon le contexte. Ils MUST rester compacts, ne pas masquer
  durablement le document et préserver leur brouillon pendant une adoption de
  synchronisation.
- **FR-090**: Une ligne de page ou de dossier dans l'arborescence MUST être
  déplaçable au pointeur depuis sa surface, sans poignée de déplacement
  permanente. Le seuil de geste MUST distinguer un clic d'un glisser-déposer,
  les commandes imbriquées MUST rester activables et les alternatives clavier
  de réorganisation MUST rester disponibles.
- **FR-091**: Les actions contextuelles d'une page MUST apparaître dans l'ordre
  pièces jointes, création enfant, menu complémentaire ; un dossier MUST
  conserver l'ordre création enfant, menu complémentaire. La création enfant
  MUST révéler dans la ligne des choix explicites page et dossier, sans déplacer
  le titre ni modifier la taille de la ligne, et son bouton `+` MUST devenir la
  commande de fermeture dans la même surface visuelle. Cette surface MUST
  rester contenue dans les limites supérieure, inférieure et droite de la ligne
  sélectionnée ; elle MAY recouvrir la fin du titre vers la gauche et MUST
  prendre temporairement la place de la commande de pièces jointes comme dans
  la référence versionnée. Sur desktop, elle MUST contenir trois commandes de
  28 px, une respiration périphérique de 1 px et deux séparations internes de
  1 px, soit une enveloppe de 88 × 30 px. Son fond MUST être visible et distinct
  de la ligne sélectionnée ; elle MUST rester plate, sans ombre extérieure ni
  fond de popover détaché, et ses trois commandes MUST être des enfants du même
  groupe visuel.
- **FR-092**: Le panneau de pièces jointes ouvert depuis une page MUST prolonger
  visuellement sa ligne sélectionnée avec la même largeur, sans modifier la
  hauteur, la largeur ou la position de cette ligne. Il MUST afficher un en-tête
  compact avec le nombre de fichiers puis des lignes nom/taille, ou exactement
  un état vide compact ; il MUST conserver l'import et l'accès aux actions de
  fichier sans transformer l'arborescence en panneau de gestion complet. Sa
  commande MUST employer l’icône trombone de la référence versionnée, avec une
  présence discrète au repos et un état explicite au survol, au focus ou quand
  le panneau est ouvert.
- **FR-093**: Les descendants, la création en ligne et les pièces jointes MUST
  s'ouvrir et se fermer avec des transitions courtes, progressives et
  symétriques de la même famille visuelle que la référence versionnée. Leur
  géométrie et leur opacité MUST posséder un état intermédiaire observable ; la
  fermeture ne MUST pas être un démontage instantané après une ouverture
  animée. Ces transitions MUST être désactivées lorsque la réduction de
  mouvement est demandée. Une surface fermée MUST ne conserver ni hauteur, ni
  marge, ni contrôle atteignable.
- **FR-094**: L'ouverture d'un dossier MUST rendre dans la zone principale son
  emoji canonique et son titre au moyen du même composant d'identité et des
  mêmes règles de validation que pour une page. La modification MUST utiliser
  les mutations d'item existantes et se refléter immédiatement dans toutes les
  représentations de cet item.
- **FR-095**: Sur écran large, l’en-tête de la barre latérale MUST exposer une
  commande pour la masquer entièrement. Le contenu principal MUST récupérer
  progressivement l’espace libéré et exposer alors une commande persistante
  pour la réafficher. Les contrôles de la barre masquée MUST quitter l’ordre de
  focus, le focus MUST rejoindre la commande opposée après le mouvement et
  l’état MUST être restauré localement conformément à FR-004. Ce comportement
  MUST reprendre les états et le mouvement de la référence versionnée.
- **FR-023**: Images et fichiers insérés dans une page MUST réutiliser le cycle
  de vie, la sécurité, les limites, la déduplication et la disponibilité locale
  définis par la feature 005.
- **FR-024**: Un contenu intégré MUST être explicitement autorisé, rester
  identifiable lorsqu'il ne peut pas être chargé et ne pas exécuter de contenu
  non fiable dans le contexte privilégié de l'application.
- **FR-025**: Chaque nouveau type de bloc ou de marque MUST posséder un export
  durable, une validation, une transition de version et une conservation sûre
  par un client qui ne le comprend pas encore.

#### Local-first truth and compatibility

- **FR-026**: Les états localement modifié, en envoi, synchronisé, bloqué et en
  conflit MUST rester visibles mais discrets, et ne MUST jamais annoncer une
  confirmation distante avant qu'elle existe.
- **FR-027**: Toutes les opérations éditoriales sur un contenu disponible
  localement MUST continuer à fonctionner sans réseau et rejoindre la file
  durable existante.
- **FR-028**: Une fermeture inattendue MUST préserver les changements locaux et
  l'état nécessaire pour reprendre le parcours.
- **FR-029**: Un refus, une erreur de validation, une indisponibilité de clé ou
  un conflit MUST préserver la saisie et proposer une reprise compréhensible.
- **FR-030**: Un bloc inconnu MUST rester visible comme contenu non rendu,
  déplaçable et conservé sans modification de ses données.
- **FR-031**: Les documents existants MUST rester lisibles sans réécriture sur
  simple ouverture et ne migrer que par une transition documentée et sûre.
- **FR-032**: Lire, écrire, formater, réorganiser et sauvegarder localement une
  page MUST rester possible sans compte, licence ou service hébergé externe à
  l'installation MyOwnNotion.

#### Convergent multi-device page editing

- **FR-052**: Chaque transaction éditoriale validée par l'éditeur MUST être
  chiffrée et rendue durable sur l'appareil avant que l'interface affiche
  « enregistré localement » ; la transmission peut être groupée ensuite mais
  ne MUST jamais être la première copie durable.
- **FR-053**: Le corps d'une page MUST s'enregistrer automatiquement sans bouton
  de sauvegarde ni dépendance à la fermeture du navigateur.
- **FR-054**: Les mises à jour éditoriales MUST être incrémentales, causales,
  idempotentes et convergentes : leur duplication ou leur réception dans un
  ordre différent MUST produire le même état visible une fois le même ensemble
  de mises à jour reçu.
- **FR-055**: Des insertions, suppressions et mises en forme compatibles
  effectuées hors ligne dans le même bloc de texte MUST se fusionner à la
  granularité des caractères et des marques sans demander de choisir une
  version complète du bloc.
- **FR-056**: Chaque bloc persistant MUST conserver une identité stable dans la
  représentation opérationnelle ; une édition concurrente MUST rester attachée
  à ce bloc lorsqu'il est déplacé, réordonné ou réimbriqué ailleurs.
- **FR-057**: Insertions et déplacements concurrents de blocs ou sous-arbres
  MUST converger vers une hiérarchie ordonnée, déterministe, sans doublon et
  sans cycle, y compris lorsque le même bloc est déplacé sur plusieurs
  appareils.
- **FR-058**: Une suppression concurrente avec l'édition ou le déplacement du
  même bloc ou de son sous-arbre MUST produire une ambiguïté durable plutôt que
  supprimer silencieusement l'une des intentions. Le contenu supprimé et le
  contenu modifié MUST rester récupérables jusqu'à résolution.
- **FR-059**: Une mise à jour reçue pendant que la page est ouverte MUST
  s'intégrer sans remplacer le brouillon local, rattacher une édition à un autre
  bloc, perdre la sélection active ni imposer un rechargement complet lorsque
  l'opération est compatible.
- **FR-060**: Les onglets d'un même appareil MUST partager rapidement les mises
  à jour d'une page tout en conservant le stockage local chiffré comme garantie
  de durabilité et la même règle de convergence que deux appareils distincts.
- **FR-061**: Le remplacement du document canonique complet ne MUST plus être
  le chemin normal d'une frappe, d'une mise en forme ou d'une manipulation de
  bloc ; il reste réservé aux projections, imports, migrations et résolutions
  explicitement contrôlés.
- **FR-062**: Le serveur MUST connaître la frontière causale reçue de chaque
  appareil autorisé. Une compaction MUST conserver ce qui est nécessaire pour
  qu'un appareil encore autorisé et possédant ses données locales puisse
  converger après n'importe quelle durée d'absence ; seule sa révocation
  explicite autorise l'abandon de cette garantie.
- **FR-063**: La synchronisation éditoriale MUST posséder une version de
  protocole explicite. Un client précédent qui peut lire la projection
  canonique mais pas écrire des mises à jour compatibles MUST rester en lecture
  seule et recevoir une explication, jamais convertir implicitement son
  remplacement complet en écriture concurrente.
- **FR-064**: Un document historique MUST rester lisible sans réécriture dans
  un parcours de lecture. L'ouverture de sa surface éditable, lorsqu'un serveur
  est joignable et qu'aucune branche locale n'est à préserver, MUST activer
  atomiquement et vérifier le modèle opérationnel avant le premier geste ; elle
  ne MUST pas créer une branche de compatibilité dans le parcours connecté
  normal. Hors ligne, ou lorsqu'une écriture historique durable doit encore
  être acquittée, la bascule MUST rester paresseuse, reprenable et appartenir à
  la frontière sérialisée de la session d'édition : une synchronisation
  générale peut la demander mais ne MUST pas convertir en parallèle une
  branche qui accepte encore des opérations locales. Cette exigence spécialise
  FR-031 pour la transition opérationnelle v3.
- **FR-065**: Une mutation historique de remplacement complet encore en attente
  au moment de la migration MUST être soit confirmée avant la bascule, soit
  convertie une fois en opérations à partir de sa base causale ; elle ne MUST
  être ni abandonnée ni rejouée après la bascule comme remplacement aveugle.
- **FR-066**: Le modèle canonique indépendant de l'éditeur MUST rester la
  projection documentée utilisée par lecture, export, recherche, relations et
  compatibilité. La représentation opérationnelle éditoriale en est l'autorité
  causale ; sa matérialisation canonique MUST être déterministe, validée et
  réparable sans former une seconde source de vérité concurrente.
- **FR-067**: Mises à jour, points de contrôle, frontières et projections MUST
  recevoir au repos les mêmes garanties de chiffrement, intégrité, rotation de
  clés, expurgation des journaux et reprise que les autres contenus privés.
- **FR-068**: Une sauvegarde MUST inclure assez d'état opérationnel, de
  frontières et de projections vérifiées pour restaurer l'historique puis
  accepter les changements d'un appareil autorisé resté hors ligne. Une
  restauration ne MUST jamais faire gagner silencieusement le serveur sur ces
  changements locaux.
- **FR-069**: L'historique visible MUST consolider les frappes en révisions
  compréhensibles plutôt que créer une entrée par caractère, tout en conservant
  la causalité nécessaire à la convergence et les deux lignées de toute
  ambiguïté explicite.
- **FR-070**: Un bloc, une propriété ou une marque inconnue MUST conserver sa
  représentation opaque, son identité et son emplacement à travers les mises à
  jour opérationnelles, la migration, la projection canonique, l'export et la
  resynchronisation.
- **FR-071**: L'état « synchronisé » d'une référence de fichier créée hors ligne
  MUST attendre à la fois l'acceptation de l'opération documentaire et la
  présence vérifiée des octets du fichier sur le serveur ; la reconnexion ne
  MUST créer ni référence orpheline ni fichier dupliqué.
- **FR-073**: Le lancement de l'application, le retour du réseau et un signal de
  changements MUST découvrir puis reprendre les files éditoriales durables de
  toutes les pages concernées, y compris celles qui ne sont pas ouvertes. Cette
  reprise MUST être bornée en concurrence, ne MUST pas dépendre d'un geste dans
  l'éditeur et MUST conserver un état global honnête tant qu'une file reste
  locale.
- **FR-075**: Avant qu'un bloc image ou fichier créé hors ligne soit annoncé
  comme enregistré sur cet appareil, ses octets, ses métadonnées et son
  identité de transfert MUST être conservés localement de manière durable et
  confidentielle. Cette préparation MUST survivre à un rechargement, une
  fermeture brutale et un redémarrage du navigateur, puis reprendre avec le
  même `fileItemId`. Si le stockage local ne peut pas l'accepter, l'insertion
  MUST être refusée clairement avant de créer une référence orpheline.

#### Cohesive product experience

- **FR-033**: Boutons, champs, menus, panneaux, dialogues, onglets, tableaux,
  notifications et états MUST suivre des composants et règles communs plutôt
  que des variantes propres à chaque feature.
- **FR-034**: Identifiants, révisions, files de mutations et diagnostics bruts
  MUST être déplacés hors du parcours courant vers une surface secondaire
  lorsqu'ils restent utiles.
- **FR-035**: Toutes les surfaces présentes dans la version livrée, y compris
  bases structurées, fichiers, recherche, conflits, sauvegardes, sécurité,
  installation et connexion, MUST adopter le même système visuel et les mêmes
  motifs responsive.
- **FR-036**: L'interface MUST proposer des thèmes clair, sombre et système ; le
  choix MUST persister sur l'appareil et rester lisible avant, pendant et après
  le chargement.
- **FR-037**: Le français MUST être la langue initiale cohérente de toutes les
  surfaces V1 ; les textes, nombres, dates et raccourcis MUST être centralisés
  afin qu'une autre locale puisse être ajoutée sans modifier les données.
- **FR-038**: Toute surface asynchrone MUST distinguer chargement, vide,
  indisponible localement, hors ligne, erreur, réussite et conflit sans dépendre
  uniquement de la couleur.
- **FR-039**: Les actions destructives MUST utiliser une confirmation cohérente
  nommant l'objet, l'impact, la récupération possible et le choix sûr par
  défaut ; aucune ne MUST dépendre d'un dialogue natif non stylable.

#### Keyboard, responsiveness, and performance

- **FR-040**: Chaque parcours cœur MUST être entièrement réalisable au clavier,
  y compris menus contextuels, glisser-déposer, sélection multiple et
  réorganisation.
- **FR-041**: Les composants interactifs MUST posséder des libellés
  compréhensibles, des états visuels explicites, un ordre de focus cohérent et
  un focus visible.
- **FR-042**: Une action révélée au survol ou au clic secondaire MUST posséder
  une voie équivalente au toucher et au clavier.
- **FR-043**: L'interface MUST rester utilisable à partir de 320 pixels et à
  200 % de zoom, sans défilement horizontal de la page ni contrôle inaccessible.
- **FR-044**: Les parcours MUST fonctionner sur les deux dernières versions
  majeures stables de Chrome, Edge, Firefox et Safari, notamment le déplacement
  vers le parent par flèche gauche sur WebKit.
- **FR-045**: Contraste, taille des cibles, réduction des animations et ordre de
  focus MUST préserver une utilisation courante lisible et prévisible. Cette
  exigence ne crée pas de gate de certification formelle ni de validation
  spécialisée par lecteur d'écran.
- **FR-046**: Un document de 500 blocs MUST rester éditable sans blocage
  perceptible et les contrôles contextuels ne MUST pas ralentir chaque frappe.
- **FR-047**: Une hiérarchie volumineuse MUST rester navigable sans rendre en
  permanence les actions et contenus invisibles de toutes ses lignes.
- **FR-048**: L'ouverture et la fermeture d'un menu, d'un état ou d'une barre
  flottante ne MUST pas provoquer de déplacement durable du contenu ni perdre
  la sélection active.

#### Boundaries

- **FR-049**: La refonte MUST conserver le modèle canonique, les identités de
  blocs et d'items, les révisions, l'export, les garanties de chiffrement ainsi
  que le transport, l'autorisation des appareils et le rattrapage existants.
  Elle MUST remplacer explicitement le seul chemin de synchronisation du corps
  des pages qui transmet aujourd'hui un document complet.
- **FR-050**: La feature MUST uniquement présenter les capacités de bases déjà
  livrées ; elle ne MUST ajouter aucun nouveau type de propriété, moteur de
  requête ou type de vue.
- **FR-051**: La feature MUST rester strictement mono-utilisateur et ne MUST pas
  introduire présence, commentaires multi-utilisateurs, coédition entre
  identités ou assistance par IA dans le périmètre V1. Plusieurs appareils et
  onglets concurrents du même propriétaire sont explicitement dans le
  périmètre et ne constituent pas une collaboration multi-utilisateur.

### Key Entities

- **État de présentation du workspace**: préférences locales et bornées qui
  permettent de retrouver thème, largeur et visibilité de la barre latérale,
  branches ouvertes, dernier item et positions de lecture sans modifier le
  contenu canonique.
- **Sélection de blocs**: ensemble ordonné et temporaire de blocs ciblés par une
  opération commune ; il ne devient pas une nouvelle structure persistante du
  document.
- **Référence visuelle d'acceptation**: état représentatif d'un parcours sur une
  largeur et un thème donnés, approuvé pour détecter une régression de
  hiérarchie, contraste, débordement ou disposition.
- **Commande contextuelle**: action disponible autour d'une page, d'un item,
  d'un bloc ou d'une sélection, avec disponibilité, raccourci, libellé et
  conséquence explicites.
- **État opérationnel de page**: représentation causale et convergente du corps
  d'une page. Elle porte les identités, le texte riche, la hiérarchie, l'ordre,
  les suppressions et les mises à jour nécessaires pour combiner les travaux de
  plusieurs appareils du propriétaire.
- **Mise à jour éditoriale**: lot binaire ou structuré, idempotent et identifié,
  issu d'une transaction locale. Il peut être reçu plusieurs fois et dans un
  ordre différent sans modifier le résultat convergent.
- **Frontière d'appareil**: résumé causal du dernier état opérationnel connu par
  un appareil autorisé. Elle borne ce qui peut être compacté sans empêcher son
  retour.
- **Projection canonique**: document indépendant de l'éditeur, matérialisé de
  façon déterministe depuis l'état opérationnel et utilisé par les lectures,
  validations, relations, recherches, exports et sauvegardes compatibles.
- **Point de contrôle opérationnel**: état compact vérifié accompagné de sa
  frontière, utilisé pour accélérer l'ouverture, le rattrapage, l'historique et
  la restauration sans perdre les opérations encore nécessaires.
- **Ambiguïté éditoriale**: ensemble d'intentions concurrentes qui ne peuvent
  être satisfaites ensemble, par exemple supprimer et conserver le même bloc.
  Elle garde les données sources jusqu'à une résolution explicite.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un propriétaire ne connaissant pas l'application crée une page,
  la renomme, insère cinq types de blocs, en déplace un et retrouve la page en
  moins de trois minutes sans documentation.
- **SC-002**: Au moins neuf participants sur dix accomplissent du premier coup
  les parcours créer, rechercher, modifier, réordonner et retrouver une page,
  puis décrivent correctement l'état de sauvegarde de leur dernière action.
- **SC-003**: Aucun parcours essentiel ne contient de piège de focus, de
  contrôle sans libellé compréhensible ni d'état important transmis uniquement
  par la couleur dans la matrice automatisée.
- **SC-004**: Cent pour cent des actions des parcours cœur possèdent une voie
  clavier automatisée, dont une réorganisation sans glisser-déposer.
- **SC-005**: Les mêmes parcours passent sur les moteurs desktop et mobile de
  la matrice V1, sans exception propre à WebKit pour la navigation dans l'arbre.
- **SC-006**: À 320 pixels et à 200 % de zoom, chaque écran cœur vérifie que la
  largeur de page ne dépasse pas la largeur visible de plus d'un pixel.
- **SC-007**: Sur un document de 500 blocs, 95 % des frappes deviennent visibles
  en moins de 100 ms et le document devient éditable en moins de deux secondes
  sur l'appareil de référence.
- **SC-008**: Après un aller-retour entre deux pages longues, la position est
  restaurée à moins de 50 pixels du contenu mémorisé ou sur ce contenu lui-même
  si la disposition a changé.
- **SC-009**: Sur 100 scénarios automatisés combinant interruption, hors ligne,
  déplacement, formatage et reprise, aucun bloc ni caractère confirmé
  localement n'est perdu ou annoncé à tort comme synchronisé.
- **SC-010**: Les références visuelles approuvées des écrans cœur, dans les deux
  thèmes et aux largeurs de référence, ne présentent aucune différence non
  revue lors du gate de pull request.
- **SC-011**: L'audit de copie des parcours V1 ne trouve aucun texte courant en
  anglais lorsque la locale française est active, hors contenu fourni par le
  propriétaire, noms propres et diagnostics explicitement techniques.
- **SC-012**: Créer une page depuis la position courante demande au maximum deux
  actions, insérer un bloc depuis le curseur une action ou un raccourci, et
  appliquer une mise en forme à une sélection au maximum deux actions.
- **SC-013**: Le parcours complet d'édition locale réussit avec toutes les
  communications vers des services tiers bloquées.
- **SC-014**: Aucun contrôle contextuel ne provoque un déplacement de contenu
  supérieur à un pixel après ouverture puis fermeture dans les références
  visuelles stables.
- **SC-015**: Pour 1 000 suites générées d'insertions, suppressions, marques,
  créations, imbrications et déplacements réparties sur deux appareils hors
  ligne, importer le même ensemble de mises à jour dans des ordres différents
  produit cent pour cent d'états canoniques et de hiérarchies équivalents, sans
  doublon ni cycle.
- **SC-016**: Cent scénarios où deux appareils modifient des positions
  différentes du même paragraphe hors ligne fusionnent automatiquement sans
  conflit, perte de caractère ni remplacement complet de la page.
- **SC-017**: Cent scénarios combinant déplacement d'un bloc sur un appareil et
  édition de ce bloc sur l'autre conservent cent fois l'identité, le contenu et
  une position convergente ; aucune édition n'apparaît sur un bloc voisin.
- **SC-018**: Chaque scénario suppression contre édition ou déplacement expose
  exactement une ambiguïté durable et permet de restaurer les deux intentions,
  même après redémarrage, sauvegarde et restauration.
- **SC-019**: Un appareil autorisé simulé absent pendant 90 jours et 10 000
  changements distants reprend automatiquement, converge sans conflit causé
  par son seul retard et ne duplique aucune opération locale.
- **SC-020**: Une interruption forcée après chaque frontière de persistance
  locale du parcours d'édition retrouve au redémarrage soit la transaction
  entière, soit l'état précédent ; aucun état partiel n'est annoncé comme
  enregistré.
- **SC-021**: Les documents historiques, les blocs inconnus et les fichiers
  intégrés traversent migration, synchronisation, projection, export,
  sauvegarde et restauration sans perte de données représentables ni référence
  orpheline.
- **SC-022**: Après dépôt d'une image et d'un fichier avec le réseau coupé, une
  fermeture brutale suivie d'un nouveau lancement hors ligne retrouve les deux
  blocs et leurs octets ; la reconnexion reprend les transferts sous les mêmes
  identités, les vérifie une seule fois et ne crée aucun fichier dupliqué.
- **SC-023**: Sur cent déplacements couvrant les trois zones de chaque ligne,
  cent pour cent des résultats correspondent au repère avant, intérieur ou
  après affiché, sans cycle, changement de parent implicite ni ordre inversé.
- **SC-024**: Sur les cinq profils navigateur, effacer « Sans titre », attendre
  au moins deux secondes puis saisir un nouveau titre ne réinjecte jamais le
  libellé de repli ; quitter un champ encore vide l'affiche une seule fois dans
  la page et la navigation.
- **SC-025**: Les parcours créer, ouvrir, modifier la cible puis retirer une
  référence réussissent pour une page et un bookmark Web au pointeur, au clic
  droit et au clavier ; le titre d'une référence interne reste celui de sa
  cible et aucune page cible n'est modifiée après retrait.
- **SC-026**: Masquer, afficher, replier et déplier indépendamment Favoris et
  Récents survit à un rechargement sur l'appareil dans cent pour cent des cas,
  sans modifier le nombre de favoris ni l'ordre de la hiérarchie Notes.
- **SC-027**: Sur une page courte ou longue, dix changements successifs d'état
  de synchronisation déplacent le titre, les blocs et la position de lecture de
  moins d'un pixel et laissent le détail atteignable sans rejoindre la fin du
  document.
- **SC-028**: Sur les profils desktop et mobile, Favoris et Récents exposent
  chacun exactement un chevron avant leur libellé et cent changements de
  visibilité par interrupteur conservent la préférence attendue après
  rechargement.
- **SC-029**: Après cent déplacements retirant le dernier enfant d'une page,
  aucune ligne vide, aucun chevron résiduel et aucune barre d'accent latérale
  n'apparaissent ; les zones avant, intérieur et après restent identifiables
  avant le dépôt.
- **SC-030**: Les parcours distincts « Lien vers une page » et « Lien Web »
  réussissent chacun au clic et au clavier sans résultat de l'autre famille ;
  dans cent suppressions du dernier caractère lié suivies d'une frappe, aucun
  caractère nouveau ne porte l'ancienne cible et le curseur demeure visible.
- **SC-031**: Après cent renommages, déplacements et changements d'emoji d'une
  cible, toutes ses références visibles affichent son titre et son icône
  courants sans réécriture manuelle ni identité cassée.
- **SC-032**: Sur cent ouvertures du sélecteur de page, le propriétaire peut
  choisir une cible par saisie, flèches et Entrée en moins de cinq actions après
  avoir tapé son filtre ; Échap ferme l'outil sans modifier le document.
- **SC-033**: Sur les profils desktop et mobile, clair et sombre, l'apparition
  du chevron d'une branche déplace son libellé de moins d'un pixel et aucune
  feuille ne réserve une colonne de dépliage supplémentaire.
- **SC-034**: Cent adresses invalides ne créent aucun bloc ; cent adresses
  valides créent chacune un bookmark pleine largeur qui reste visible avec son
  URL lorsque la récupération d'aperçu échoue.
- **SC-035**: Sur écran large, cent cycles masquer/réafficher la barre latérale
  conservent un contenu utilisable, un seul contrôle de bascule visible, un
  retour de focus correct et l’état attendu après rechargement ; pendant chaque
  cycle, la largeur de navigation et celle du contenu possèdent au moins un
  état intermédiaire avant leur état final.
- **SC-036**: Sur cent cycles de branche, le même nœud chevron passe
  progressivement de 0 à 90 degrés puis revient, le titre se déplace de moins
  d’un pixel, la région des descendants possède une hauteur intermédiaire et la
  fermeture laisse une hauteur et une marge inférieures à un pixel sans
  contrôle focalisable.
- **SC-037**: Sur cent ouvertures et fermetures de la création enfant, le
  rectangle de la ligne varie de moins d’un pixel et tous les contrôles révélés
  restent à l’intérieur de ses limites supérieure, inférieure et droite ; le
  `+` et sa croix sont le même contrôle animé et la fermeture possède un état
  intermédiaire visible. À l’état ouvert desktop, l’enveloppe mesure 88 × 30 px,
  les trois commandes sont séparées d’un pixel, son fond calculé n’est pas
  transparent et son ombre calculée vaut `none`.
- **SC-038**: Dans les cas zéro, un et plusieurs fichiers, cent cycles du
  trombone conservent le rectangle de la ligne à moins d’un pixel, raccordent le
  panneau à la même largeur à moins d’un pixel, traversent une hauteur
  intermédiaire et reviennent à moins d’un pixel de hauteur résiduelle.

## Assumptions

- La cible est une expérience propre et familière inspirée de Notion, pas une
  reproduction de sa marque, de ses icônes, de chaque pixel ni de toutes ses
  fonctions commerciales.
- Le modèle canonique indépendant de l'éditeur reste le contrat sémantique et
  d'export obligatoire. La représentation opérationnelle est l'autorité de
  causalité pour l'édition ; la conversion vers le modèle canonique est une
  projection déterministe, pas une deuxième branche éditable.
- Les fichiers intégrés utilisent la fondation 005. L'autorisation des
  appareils, le flux de changements, le rattrapage général et la file chiffrée
  utilisent la fondation 006 ; la 017 remplace seulement son écriture et sa
  fusion du corps complet des pages.
- Un appareil reste admissible à la convergence tant qu'il est autorisé et
  possède ses données locales intactes. Une longue absence peut augmenter le
  volume à rattraper mais ne transforme pas seule son travail en conflit.
- Les bases de la 009 étant déjà présentes dans la version de développement,
  elles reçoivent le système visuel commun, mais leurs capacités fonctionnelles
  ne deviennent pas pour autant une nouvelle obligation produit de la V1.
- Le thème initial suit le système lorsque le propriétaire n'a pas encore fait
  de choix explicite.
- La locale initiale est le français et les données canoniques restent
  indépendantes des libellés traduits.
- Les références visuelles sont approuvées sur des états contrôlés et sans
  donnée personnelle ; elles complètent les tests de comportement sans les
  remplacer.
- Les anciens blocs inconnus et documents hérités restent conservés même si
  leur apparence ne peut pas bénéficier de toutes les nouvelles interactions.
- Les préférences de visibilité et de repli de la barre latérale sont propres à
  l'appareil, comme sa largeur et ses branches ouvertes ; elles ne sont pas des
  données éditoriales synchronisées.

## Out of Scope

- Parité intégrale avec Notion, import Notion ou compatibilité avec son format.
- Coédition multi-utilisateur, présence, commentaires d'équipe et permissions
  entre plusieurs comptes.
- Curseurs partagés, avatars ou présence entre les appareils du propriétaire ;
  la convergence de contenu n'a pas besoin de simuler une équipe.
- Assistance d'écriture ou génération de contenu par IA.
- Nouveaux types de bases, propriétés, filtres ou vues au-delà de la 009.
- Graphe, tableaux blancs, partage public, annotations et MCP, qui conservent
  leurs features dédiées.
- Prévisualisation ou édition Draw.io. Les fichiers restent téléchargeables via
  la fondation 005 ; un futur moteur de diagrammes interne appartient à la
  feature tableaux blancs ou à une feature de suivi postérieure.
- Remplacement du modèle canonique par le format interne d'un moteur d'édition,
  ou utilisation du document interne complet de cet éditeur comme unité de
  synchronisation.
- Dépendance obligatoire à un service hébergé ou à une licence individuelle
  pour utiliser les parcours essentiels de l'application auto-hébergée.
- Certification formelle WCAG, campagne VoiceOver ou prise en charge spécialisée
  des technologies d'assistance au-delà de l'ergonomie personnelle demandée :
  clavier, focus visible, pointeur et toucher restent obligatoires.
