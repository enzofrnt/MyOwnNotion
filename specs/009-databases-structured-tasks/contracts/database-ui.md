# UI Contract: Bases de données et tâches structurées

Ce contrat décrit les comportements observables des cinq vues. Il complète le
contrat HTTP ; il ne fixe ni couleurs, ni composition CSS définitive.

## 1. Cadre commun

Une base ouverte affiche toujours, dans cet ordre logique :

1. fil d'Ariane et titre de la page hôte ;
2. état de sauvegarde/synchronisation et couverture ;
3. barre de vues enregistrées ;
4. actions de vue, filtre, tri, groupe et création d'entrée ;
5. contenu de la vue ;
6. panneau d'entrée lorsqu'une page est ouverte.

Changer de vue conserve la base et la sélection pertinente. Ouvrir une entrée
met à jour l'URL avec son identité, jamais avec son titre ni une valeur privée.
Fermer le panneau rend le focus au déclencheur si celui-ci est toujours visible,
sinon à la vue puis à l'entrée la plus proche dans l'ordre courant.

Chaque vue expose par un texte visible et une région `aria-live` :

- son nom et son type ;
- le nombre d'entrées connues ;
- les filtres, tris et groupes actifs ;
- `Résultat complet` ou `Données locales partielles : X sur Y` ;
- enregistré localement, en attente, synchronisé, erreur ou conflit ;
- une configuration de vue devenue invalide.

Une absence de résultat partielle se formule « aucune entrée dans les données
disponibles », jamais « aucune entrée ».

## 2. Barre de vues et configuration

- La barre est une liste de boutons/onglets nommés. Flèche gauche/droite change
  le focus, Entrée active la vue, les actions de réordonnancement ont aussi des
  boutons « déplacer avant/après ».
- Créer ou dupliquer une vue demande un nom et un type, puis confirme la
  création locale avant synchronisation.
- Supprimer la dernière vue est refusé avec une raison visible.
- Filtre, tri et groupe sont affichés comme des règles lisibles, réordonnables
  sans pointeur et réinitialisables en une action.
- La combinaison de filtres annonce explicitement « toutes les règles » ou
  « au moins une règle ».
- Une propriété retirée ou conflictuelle laisse la règle visible en état
  invalide. La règle n'est ni appliquée ni ignorée silencieusement ; la vue
  demande correction avant d'annoncer un résultat complet.

## 3. Édition de propriété

Chaque éditeur conserve la saisie non validée jusqu'à correction ou annulation.
Un refus place le message près du champ et dans le résumé d'erreur, sans inclure
la valeur dans un diagnostic technique.

- texte : zone de texte, chaîne vide distincte de l'absence ;
- nombre : saisie localisée, aperçu de la valeur canonique, ambiguïté refusée ;
- date : choix explicite date civile ou instant selon la propriété ;
- statut/sélection : options nommées ; la couleur n'est jamais le seul signal ;
- multi-sélection : liste de cases/jetons nommés et supprimables au clavier ;
- checkbox : contrôle natif nommé ;
- relation : combobox propriétaire sur pages actives, identité stable, cible
  indisponible indiquée sans redirection.

Un changement de type, retrait de propriété ou retrait d'option commence par un
aperçu indiquant les nombres d'entrées et valeurs affectées. Si l'état a changé
avant confirmation, l'action est refusée et l'aperçu est recalculé.

## 4. Table

La table éditable suit le pattern ARIA `grid`.

- `Tab` entre dans la grille sur une seule cellule mémorisée.
- Flèches déplacent le focus entre cellules ; Home/End vont au début/à la fin
  de ligne ; Ctrl+Home/Ctrl+End vont aux extrémités disponibles.
- Entrée, F2 ou une touche imprimable entre en édition lorsque le type le
  permet.
- Échap annule la saisie courante et revient à la cellule ; Entrée valide puis
  revient au mode navigation.
- Tab en mode édition parcourt les contrôles internes ; il ne simule pas le
  déplacement entre toutes les cellules.
- L'en-tête annonce nom, type, tri et actions de colonne.
- Le redimensionnement possède boutons/raccourcis et une valeur annoncée ; il
  n'est pas limité à une poignée de pointeur.
- La propriété titre reste la première identité ouvrable.

La virtualisation conserve `aria-rowcount`, `aria-rowindex` et les positions
logiques. Un focus ne disparaît pas lors d'un remount ; la ligne focalisée reste
dans l'overscan ou le focus est replacé explicitement avant démontage.

## 5. Liste

- Structure native de liste ; chaque entrée possède un lien/bouton de titre.
- Les propriétés secondaires gardent libellé et valeur.
- Flèches ne remplacent pas Tab ; des raccourcis optionnels sont annoncés.
- L'ordre de lecture est identique à l'ordre visuel et canonique.

## 6. Kanban

- La vue est une région contenant des colonnes nommées par les options de la
  propriété axe, plus « Sans valeur ».
- Chaque colonne annonce son nombre de cartes et contient une liste.
- Une carte affiche titre et propriétés choisies et ouvre la page canonique.
- Le glisser-déposer met à jour la propriété axe uniquement après une cible
  autorisée.
- Chaque carte fournit une action clavier « Changer le statut/la sélection »,
  ouvrant une liste des colonnes. Ce chemin produit exactement la même commande
  que le drag-and-drop.
- Colonne, nouvelle valeur et état de sauvegarde sont annoncés après mouvement.
- Une option retirée reste lisible comme indisponible jusqu'à résolution.

## 7. Galerie

- Structure de liste de cartes ; le titre est toujours textuel et ouvrable.
- L'aperçu utilise uniquement un document ou fichier déjà autorisé et présent.
- Sans aperçu, la carte affiche « Aucun aperçu disponible » ; elle ne déclenche
  aucun téléchargement ou traitement distant implicite.
- Les propriétés choisies sont nommées et ne reposent pas sur l'image.

## 8. Calendrier

- Le titre du mois, les contrôles précédent/suivant/aujourd'hui et l'identité de
  la propriété date sont annoncés.
- La grille calendaire utilise des boutons de jour nommés avec date complète.
  Chaque jour expose ensuite une liste d'entrées, plutôt qu'une grille éditable
  imbriquée.
- Les entrées sans date restent dans une région « Non planifiées » avant ou
  après le calendrier selon le viewport.
- Le glisser-déposer vers un jour a une action clavier équivalente « Modifier
  la date ».
- Une date civile reste au même jour après changement de fuseau. Un instant est
  rendu dans le fuseau courant avec sa date et son heure.

## 9. Tâches structurées

Une base de tâches affiche dans son panneau de propriété :

- statut obligatoire ;
- échéance lorsqu'elle est mappée ;
- priorité lorsqu'elle est mappée ;
- autres propriétés ordinaires ;
- corps de page par blocs dans le même parcours.

Le libellé « tâche » est une présentation de l'entrée, pas une identité
distincte. Modifier un rôle depuis une carte, la table, le calendrier ou le
panneau produit la même mise à jour de valeur. Une case à cocher du document
reste dans l'éditeur et n'apparaît jamais dans les propriétés de tâche.

## 10. Offline, chargement et conflits

États obligatoires :

| État | Présentation |
| --- | --- |
| loading-local | Squelette de structure, aucune fausse ligne |
| local-complete | Toutes les appartenances et valeurs nécessaires sont présentes |
| local-partial | X/Y et limites explicites sur résultats/groupes/totaux |
| server-loading | Résultat local conservé pendant la demande complète |
| complete | Résultat serveur ou local vérifié complet |
| offline | Résultat local conservé, écriture durable en attente possible |
| stale-cursor | Contexte conservé, première page rechargée, annonce du changement |
| invalid-view | Règle concernée visible et action de réparation |
| conflict | Version locale, distante et ancêtre accessibles avant résolution |
| degraded | Aucune prétention de complétude ; données locales sûres conservées |

Une modification optimiste change immédiatement la ligne ou carte et annonce
« enregistré localement ». Si la validation locale échoue, l'ancien état reste
visible et la saisie est conservée. Si le serveur trouve un conflit, la version
locale n'est pas remplacée par la distante.

## 11. Responsive et zoom

- À 320 px ou 200 %, le titre, la barre de vues, la création d'entrée, la
  couverture et les actions courantes restent accessibles sans défilement
  horizontal de la page.
- La table possède son propre conteneur bidimensionnel nommé ; ses commandes ne
  défilent pas avec les colonnes.
- Le Kanban peut faire défiler ses colonnes dans une région nommée ou les
  présenter en accordéon vertical ; l'action clavier ne dépend pas de ce choix.
- Galerie et liste passent à une colonne.
- Calendrier peut afficher semaine/jour en présentation étroite, mais conserve
  toutes les entrées et la zone non planifiée.
- Le panneau d'entrée devient une page modale plein écran avec fermeture et
  retour de focus déterministes.

## 12. Critères Playwright communs

Chaque projet navigateur doit prouver au minimum :

1. création d'une base et d'une entrée ;
2. édition de chaque type de propriété ;
3. filtre ALL/ANY, tri multiple et groupe ;
4. changement entre les cinq vues sans duplication d'identité ;
5. mouvement Kanban et calendrier par pointeur et par clavier ;
6. ouverture/fermeture d'entrée avec retour de focus ;
7. persistance après rechargement ;
8. modification offline, redémarrage et synchronisation ;
9. résultat local partiel correctement annoncé ;
10. conflit conservant toutes les versions ;
11. parcours 320 px et zoom 200 % ;
12. audit axe sans violation critique ou sérieuse sur le parcours.
