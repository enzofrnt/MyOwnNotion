# Dossier de référence Notion — visuels et parcours

**État au 11 novembre 2026 :** dossier documentaire préparatoire, pas une
validation de parité. Les médias publics et les captures ciblées réalisées sur
la page de test expressément autorisée par le propriétaire sont distingués
ci-dessous. Les
[références fonctionnelles et leurs sources](notion-reference-fonctionnelle.md)
complètent ce dossier. Les priorités et écarts de MyOwnNotion restent dans
[audit-reprise.md](audit-reprise.md), les critères dans [spec.md](spec.md) et
les travaux dans [tasks.md](tasks.md).

## Visuels et démonstration publics

| Sujet | Fichier / provenance | Ce que l'on voit | Ce que cela ne prouve pas |
| --- | --- | --- | --- |
| Formule | [Éditeur, illustration publique](evidence/notion-public/formula-editor.webp), [aide officielle](https://www.notion.com/help/formulas) | Éditeur, liste de propriétés et documentation avec exemples insérables. En anglais ; illustration de la documentation qui peut représenter une version antérieure. | État français actuel, débogueur, validation, dimensions actuelles, clavier ou mobile. |
| Relations | [Deux bases reliées](evidence/notion-public/relations-rollups.webp), [aide officielle](https://www.notion.com/help/relations-and-rollups) | Deux tables synthétiques et leurs propriétés de relation ; contexte nécessaire à l'agrégation. | Menu de configuration du rollup ou ensemble des calculs. |
| Lieu et carte | [Démonstration animée officielle](evidence/notion-public/map-demo.gif), [annonce Notion 3.1 du 17 novembre 2025](https://www.notion.com/releases/2025-11-17) | Démonstration publique de la propriété Place et du changement de vue en carte. Ouvrir le GIF animé, pas uniquement sa première image. | États d'erreur, résultats de recherche selon région, mobile et version actuelle. |

### Séquence carte relevée sur le média public

Ces deux images sont extraites du GIF officiel ci-dessus (1 s et 3 s, format
natif 1200 × 900), et non de la session de l'utilisateur :

1. [Table avec propriété Place](evidence/notion-public/map-demo-01.png) :
   une colonne Place est affichée à côté du titre et d'une catégorie ; une
   vue Map existe comme onglet voisin de Table.
2. [Carte et aperçu d'un lieu](evidence/notion-public/map-demo-03.png) :
   l'onglet Map est actif, la carte occupe la surface de la vue ; des marqueurs
   et une carte d'aperçu comprenant nom et image sont visibles.

C'est une démonstration promotionnelle de 2025, pas une mesure du comportement
actuel : les images seules ne disent pas si l'aperçu a été ouvert au clic ou au
survol, ni ce qu'il advient hors ligne.

Notion propose aussi deux démonstrations publiques filmées : le [guide vidéo
Relations et agrégations](https://www.notion.com/help/guides/using-relation-and-rollup-properties)
(vidéo de quatre minutes intégrée dans la page) et la vidéo intégrée à
[l'aide Relations et agrégations](https://www.notion.com/help/relations-and-rollups).
Elles fournissent un parcours complémentaire, mais leur lecteur, leur date et
l'état réel de l'interface sont à vérifier : leur contenu n'a pas été visionné
ni découpé en captures dans cette reprise.

Les médias sont des copies de ressources publiées par Notion, conservées ici
comme références de développement ; vérifier leur provenance et les droits
avant toute redistribution extérieure au projet. Ne pas les traiter comme des
mesures de style ou une liste exhaustive de capacités. URLs directes :
[éditeur](https://images.ctfassets.net/spoqsaf9291f/3mfjLubTiV8GZ4wROlrShU/3bbd7a20ce0641828282e4991a1afbf6/Image_from_Notion__5_.png?w=3840&q=55&fm=webp),
[relations](https://images.ctfassets.net/spoqsaf9291f/2ZxBndJzurrMDC8TGewWRu/6d9f33c3cb998233bda8fa3d3d525ab4/two_database_relation.png?w=1920&q=55&fm=webp),
[carte animée](https://images.ctfassets.net/spoqsaf9291f/17Nt38aNjAjrSK6b7Tg9Vy/3a7d42b3c017e587c398b33de644743d/06_Map_View_Team_Offsite.gif).

## HTML archivé : documentation publique, pas DOM applicatif

Les trois fragments HTML publics extraits le 11 novembre 2026 sont dans
`.notion-lab/parity/reference-publique/` : `formules.html`, `agregations.html`,
`lieux-cartes.html`. Le navigateur a été lancé **sans profil connecté** ; les
scripts, iframes, styles, formulaires et attributs d'événement ont été retirés.
Ces fichiers sont ignorés par Git : ils restent disponibles localement mais ne
suivent pas un clone ou un nettoyage. Recréer depuis les trois URLs d'aide
ci-dessus si nécessaire. Ils contiennent l'article public, **pas le DOM de
l'éditeur Notion**, ni ses styles calculés, ni une preuve de comportement.

## Captures interactives réalisées sur la page expressément autorisée

Le propriétaire a ensuite autorisé explicitement les manipulations sur sa page
de démonstration. Le 11 novembre 2026, en français et thème clair, Chromium
1440 × 1000 a ouvert cette page. Les captures publiées ici cadrent uniquement
la surface concernée ; elles n'incluent ni sidebar ni noms de lignes. La ligne
choisie pour l'aperçu de formule est masquée en gris et 8 pixels sont retirés en
haut des images de formule pour éviter l'arrière-plan aux coins. Les JSON
contiennent dimensions, une partie des styles et `html` de la surface expurgé
d'identifiants, images, SVG et liens ; ce n'est pas le DOM brut complet et il
ne faut pas l'utiliser pour mesurer les icônes. Les fichiers de script et
captures brutes restent ignorés dans `.notion-lab/`.

### Formule : parcours observé

- [Vide](evidence/notion-reference/formule/01-vide.png) : panneau de 740 × 541
  CSS px ; titre, champ IA (hors périmètre du produit), éditeur, aperçu et
  commutateur de débogage, puis navigation des propriétés et documentation.
  Texte « Aucune sortie » et « Type : inconnu ». L'entrée d'aperçu est masquée.
- [Expression incomplète](evidence/notion-reference/formule/02-erreur.png) :
  `1 +` affiche « Expression attendue. [2,3] » et souligne le signe ; l'action
  « Annuler toutes les modifications » apparaît en haut. La persistance de
  l'expression invalide après fermeture n'a pas été testée.
- [Expression valide](evidence/notion-reference/formule/03-valide.png) :
  `1 +1 + 2` produit `4`, type numéro ; liste d'opérateurs et exemples visibles.
- [Débogage actif](evidence/notion-reference/formule/04-debogage.png) :
  commutateur activé et annotation `num` près du résultat ; aucun débogage
  imbriqué ni choix d'une autre entrée n'a été vérifié.
- [DOM/styles expurgés : vide](evidence/notion-reference/formule/01-vide.json),
  [erreur](evidence/notion-reference/formule/02-erreur.json),
  [valide](evidence/notion-reference/formule/03-valide.json),
  [débogage](evidence/notion-reference/formule/04-debogage.json).

### Agrégation : parcours observé

- [Configuration initiale](evidence/notion-reference/agregation/01-configuration.png) :
  Relation, Propriété cible, Calculer ; les deux dernières lignes sont grisées
  tant qu'aucune relation n'est choisie. [DOM/styles expurgés](evidence/notion-reference/agregation/01-configuration.json).
- [Choix de relation](evidence/notion-reference/agregation/02-choix-relation.png),
  [configuration après choix](evidence/notion-reference/agregation/03-configuration-avec-relation.png)
  et [propriétés cibles](evidence/notion-reference/agregation/04-choix-propriete.png).
  Le choix de relation a présélectionné `Name` et « Afficher l’original » ; la
  configuration affichée ensuite montre la cible Texte.
- Pour Texte : [menu Calculer](evidence/notion-reference/agregation/05-calcul-texte.png),
  [sous-menu Quantité](evidence/notion-reference/agregation/06-calcul-quantite.png)
  et [sous-menu Pourcentage](evidence/notion-reference/agregation/07-calcul-pourcentage.png).
  Le menu propose « Afficher l’original », « Afficher les valeurs uniques »,
  Quantité et Pourcentage ; Quantité comprend Tout compter, Compter les valeurs,
  Valeurs uniques, Cellules vides et Cellules non vides.
- Pour Numéro : [menu](evidence/notion-reference/agregation/08-calcul-numero.png)
  et [sous-menu Plus d’options](evidence/notion-reference/agregation/09-calcul-numero-detail.png) :
  Somme, Moyenne, Médiane, Minimum, Maximum, Intervalle. Un panneau de réglages
  de format nombre/décimales/affichage est apparu lors du choix de cible.
  [DOM expurgé du menu](evidence/notion-reference/agregation/08-calcul-numero.json).
  Ces observations sont limitées aux propriétés de test, pas à tous les types.

### Lieu et carte : parcours observé

- [Lieu vide](evidence/notion-reference/lieu/01-vide.png) : champ de recherche
  et option « Emplacement actuel », panneau 240 × 73 CSS px.
- [Recherche d'un lieu public](evidence/notion-reference/lieu/02-recherche.png) :
  `Musée du Louvre, Paris` affiche des suggestions titre/adresse et la mention
  « Les résultats peuvent être limités. En savoir plus. » ; le panneau est
  borné à 240 × 333 CSS px et comporte une liste défilante. Les réponses varient
  selon fournisseur, réseau et localisation.
- [Requête sans résultat](evidence/notion-reference/lieu/03-sans-resultat.png) :
  aucune suggestion n'est visible, mais l'action position actuelle et la mention
  de limitation restent. [Cellule après sélection](evidence/notion-reference/lieu/04-lieu-selectionne.png)
  : le texte est partiellement coupé par le défilement horizontal, donc ne vaut
  pas preuve de son rendu complet.
- [DOM/styles : vide](evidence/notion-reference/lieu/01-vide.json),
  [résultats](evidence/notion-reference/lieu/02-recherche.json),
  [aucun résultat](evidence/notion-reference/lieu/03-sans-resultat.json).
- [Ajouter une vue](evidence/notion-reference/carte/01-ajouter-vue.png) propose
  une grille de formats dont Carte. [Carte réelle](evidence/notion-reference/carte/02-carte.png)
  après sélection du Louvre : surface 954 × 600 CSS px, un marqueur relevé.
  L'ouverture du marqueur n'a pas été capturée afin d'éviter le nom de la ligne.

Ces essais ont ajouté Formule, Agrégation, Relation, Lieu et Numéro ainsi
qu'une vue Carte à la base de démonstration ; le lieu public a été affecté à
une ligne existante. Ils ne constituent pas une comparaison avec MyOwnNotion.
Les captures historiques avec sidebar ne doivent toujours pas être publiées.
Clair desktop uniquement : pas encore de sombre, 320/390, aperçu sur deux lignes,
rollup dates/résultats, clavier, refus de position ou erreur réseau. Une tentative
sur l'exemple Notion public interactif a reçu HTTP 429.

## Cahier de capture immédiatement exécutable après accès à un espace isolé

Ne jamais utiliser le workspace personnel. Créer dans **l'espace de test** une
page « Parité propriétés — synthétique », deux bases « Projets » et « Achats »
et uniquement les exemples ci-dessous. Éviter tout nom ou adresse personnelle.
Noter version/URL de la page de test (sans secret), date, langue, thème,
viewport, navigateur et plan Notion. Capturer l'élément ouvert, son HTML isolé,
sa géométrie, ses styles, et le parcours précis. Les captures complètes et
HTML peuvent contenir sidebar, URL, identifiants et données : conserver les
bruts dans `.notion-lab/parity/`, puis vérifier chaque sortie avant partage.
Voir [notion-parity](../../.agents/skills/notion-parity/SKILL.md) pour le
format de recettes, les styles au repos/survol et les comparaisons.

### Données synthétiques proposées

- **Achats** : `A` nombre 10, date 2026-01-01, case cochée, catégorie `Bleu` ;
  `B` nombre 20, date 2026-01-10, case décochée, catégorie `Bleu` ; `C` nombre
  vide, date vide, case décochée, catégorie `Vert`.
- **Projets** : `Projet AB` relié à A et B ; `Projet vide` sans relation ;
  `Projet ABC` relié aux trois. Ajouter propriétés Formule, Agrégation et Lieu.
  Pour les aperçus, choisir explicitement deux projets aux résultats distincts.
- **Lieux** : saisir seulement des lieux publics, par exemple `Tour Eiffel,
  Paris` et `Musée du Louvre, Paris`. La recherche part vers un fournisseur tiers.
  Ne pas autoriser la géolocalisation réelle ; tester le refus ou une position
  synthétique avec l'émulation navigateur. Ne jamais capturer de position privée.

### Agrégation : états précis

1. Créer une propriété Agrégation ; capturer menu de colonne, configuration
   initiale et les sélecteurs Relation, Propriété cible et Calculer. Relever
   contrôles désactivés, indications et ordre.
2. Choisir la relation vers Achats puis, successivement, nombre, date, case et
   catégorie. Pour chacun, ouvrir la liste Calculer et relever **les options
   effectivement visibles** avec ordre, sections, icônes, dimensions, états,
   infobulles et éventuelle recherche. L'API a 24 identifiants : ce chiffre ne
   prouve pas que 24 options sont affichées pour chaque type.
3. Photographier puis lire les résultats : somme de A+B, moyenne de ABC,
   agrégat d'une relation vide, nombre de valeurs vides, valeurs uniques et
   dates extrêmes. Noter précisément le rendu d'une liste et d'un résultat vide.
4. Changer de relation, supprimer/renommer une propriété cible **de test** et
   vérifier sélection, avertissement et récupération. Tester tri et filtre selon
   le type de résultat ; l'aide officielle documente le tri numérique seulement.
5. Refaire la capture survol/focus, clavier/Échap, clair/sombre, puis 320/390 px.

### Formule : états et séquence

1. Ouvrir l'éditeur par en-tête puis configuration ; capturer l'ouverture,
   le champ, la palette, la recherche, les catégories, la documentation et les
   exemples. L'IA est explicitement hors périmètre produit : noter sa présence
   sans prévoir sa reproduction.
2. Insérer une propriété et une fonction, saisir `prop("Nombre") * 2` dans une
   base comportant `Nombre`, puis une formule référençant une agrégation.
   Capturer le résultat, son type et l'entrée affichée dans l'aperçu.
3. Changer d'entrée d'aperçu et noter ce qui change. Déclencher puis photographier
   erreur syntaxique, référence absente et valeur vide ; vérifier si le brouillon
   et la formule précédente sont conservés après fermeture/enregistrement. Ne
   pas inférer ces comportements de la documentation.
4. Relever mode débogage, aide détaillée, navigation clavier, insertion au curseur,
   fermeture, focus, état de chargement et débordement ; captures clair/sombre,
   320/390 et dimensions réelles desktop. Comparer avec le candidat ensuite.

### Lieu et carte : états et séquence

1. Ouvrir une cellule Lieu vide, saisir les lieux publics et capturer champ,
   chargement, liste de suggestions, texte secondaire, sélection, suppression,
   aucun résultat et état requête vide. Noter langue, délai perçu et fournisseur
   seulement s'il est réellement démontré ; aucune promesse de classement identique.
2. Tester saisies rapides et réponses retardées ; l'outil ne doit pas donner une
   fausse preuve si le réseau ne permet pas d'inverser les réponses. Tester refus
   de position, perte réseau et reprise sans envoyer de position personnelle.
3. Créer une carte avec et sans propriété Lieu préexistante ; observer l'ajout
   éventuel, le choix de propriété, pins, clic ouvrant la page, zoom et filtre
   sur nom et adresse. Photographier carte vide, carte peuplée, et états d'erreur
   accessibles ; noter que la limite documentée est de 100 éléments affichés.
4. Répéter les parcours utiles au clavier, en clair/sombre et 320/390 px.

## Relevé à remplir pour chaque capture

| Champ | Valeur attendue |
| --- | --- |
| Identifiant | Exemple `rollup-number-calculer-light-1440` ; référence et candidat distincts |
| Contexte | Date, plateforme, version si visible, langue, thème, dimensions, plan |
| Étapes | État initial, clics/saisie/clavier, données synthétiques, sélecteur de surface |
| Structure | Textes exacts, sections/ordre, éléments présents/désactivés, sous-menus |
| Mesures | Boîtes, padding/gap, typographie, couleurs calculées, coins, ombre |
| États | Repos, survol, focus, ouvert, chargement, vide, erreur/reprise, succès |
| Interaction | Clavier, Échap/retour du focus, clic droit si pertinent, résultat et persistance |
| Fichiers | Capture, HTML de surface, JSON/styles, recette et comparaison ; aucun secret |
| Limites | Indiquer état non observé, réseau, région, version, occlusion ou données manquantes |

`T100` demeure ouverte : les exemples officiels et ce protocole ne sont pas les
captures interactives demandées. Vérifier les captures elles-mêmes et le nombre
d'items avant de déclarer un parcours observé ; une capture de menu fermé ne
prouve rien sur son contenu.
