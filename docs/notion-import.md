# Import Notion par API

L'import de fichiers Markdown/CSV/ZIP et de dossiers Obsidian est supprimé.
La CLI lit maintenant Notion directement, sans modifier les données source.
L'import est ponctuel ; ce n'est pas une synchronisation continue.

## Accès et découverte

Créer une intégration Notion disposant de la lecture des contenus et lui
partager les pages/bases à importer. Seuls les objets accessibles sont visibles.
Le jeton est lu depuis `NOTION_TOKEN` ou un fichier privé (0600) désigné par
`NOTION_TOKEN_FILE`. Il n'est jamais accepté comme argument de commande,
enregistré dans l'import ou affiché dans les journaux. Ne pas le mettre dans Git.

```bash
export NOTION_TOKEN_FILE=/chemin/prive/notion-token
bun run import:notion --discover --json
```

`--json` contient les titres et identités privées, destinés au propriétaire.
Sans cette option, la sortie contient uniquement des comptes et codes sûrs.
La version d'API testée est `2026-03-11`.

## Aperçu puis application

```bash
bun run import:notion --root UUID_NOTION --id UUID_IMPORT
bun run import:notion --all --id UUID_IMPORT --json
```

Plusieurs `--root` peuvent être fournis. Pour exclure une base précise, ajouter
`--exclude-database UUID_BASE_NOTION` (répétable) à l'aperçu et à l'application.
La base, ses sources, membres et descendants sont omis de la projection ; aucune
exclusion universelle par nom n'est faite. La sélection exclue est conservée
avec le plan pour la reprise. La collecte peut encore lire ces objets en mode
`--all`, avant le filtrage ; l'option ne modifie jamais Notion.

Plusieurs racines peuvent être sélectionnées. `--all` sélectionne les objets
accessibles. Une source sélectionnée entraîne la lecture de son propriétaire
et des autres sources de cette base pour conserver une seule page de base.
L'aperçu n'ouvre pas la base MyOwnNotion et n'écrit aucun cache privé sur disque.
`--dry-run` a priorité sur `--apply`.

Examiner les avis de conversion, puis fournir les paramètres explicites de la
cible : `DATABASE_URL`, `MYOWNNOTION_BLOB_ROOT`, `MYOWNNOTION_BACKUP_ROOT` et
`MYOWNNOTION_DEPLOYMENT_KEY_FILE`. Pour les exécutions locales, PostgreSQL 18
`pg_dump` et `pg_restore` doivent être dans PATH. Le conteneur API les fournit.

```bash
bun run import:notion --all --id UUID_IMPORT --apply
```

Chaque nouvelle application prend une sauvegarde complète vérifiée. Le serveur
refuse une installation inactive, une migration en attente, une clé indisponible
ou une politique d'écriture bloquée. Les objets sont regroupés sous « Import
Notion ». Contenu, fichiers, originaux et snapshot sont chiffrés au repos.
L'archive originale reste dans le snapshot privé de récupération : elle
n'ajoute ni dossier « Sources importées » ni fichier JSON à l'arborescence.
Le compteur d'originaux du rapport désigne cette archive privée.

Une nouvelle collecte peut observer des modifications ou de nouvelles URL de
médias. Après un début d'application, utiliser la reprise du snapshot original :

```bash
bun run import:notion --resume --id UUID_IMPORT
bun run import:notion --resume --id UUID_IMPORT --dry-run --json
```

La reprise ne contacte pas Notion, conserve les identités et n'écrase pas les
éditions locales ultérieures. Une collecte interrompue avant application ne
crée aucun contenu local ; la relancer. Ctrl+C annule la collecte ou arrête
entre les opérations canoniques. Les opérations déjà acceptées restent durables.

## Fidélité et limites

Pages/sous-pages, texte riche, listes, cases, toggles, callouts, code, tableaux,
images et pièces jointes, équations de bloc/en ligne, sommaires, mentions de pages
et liens internes deviennent des objets
natifs. Chaque base garde ses sources et chaque ligne sa propre appartenance.
Les options/couleurs et les relations accessibles sont conservées.

Les types de propriétés natifs sont titre, texte, nombre, date/instant, statut,
sélection, sélection multiple, case et relation. Les propriétés Personne,
auteur et dernier éditeur sont ignorées. Les couvertures des pages et bases
sont exclues ; MyOwnNotion ne prévoit pas de couvertures de page.
Les fichiers de propriété,
formules, agrégations, URL et métadonnées sans type natif conservent une valeur
lisible et leur original JSON protégé. Les formules ne sont pas exécutées.
Les plages de dates et fuseaux ne sont pas entièrement représentables.
Les propriétés texte gardent leur texte simple ; leurs marques originales,
groupes de statuts et formats de nombres non traduits sont conservés et signalés.
Les pages découvertes mais absentes d'une requête de source sont également
collectées. Les modèles identifiés deviennent des pages ordinaires, sans règle
de création automatique.

Les vues simples table/Kanban/galerie/liste/calendrier sont traduites quand
leurs propriétés sont compatibles. Les filtres simples et tris compatibles sont
traduits. Les requêtes ou configurations non traduites produisent une table
clairement nommée comme fallback et un avis ; leurs réglages d'origine sont dans
le snapshot. Le Kanban natif accepte les axes statut, sélection simple et
sélection multiple (comme « Matière »). Une entrée portant plusieurs options
apparaît dans chaque colonne, sans duplication canonique. Déplacer une carte
remplace son appartenance d'origine et conserve les autres sélections ; la
destination « Sans valeur » retire explicitement toutes les sélections.
La table accepte le regroupement par statut/sélection simple/sélection multiple/case.
Un regroupement par texte ou propriété indisponible devient
une « table sans regroupement (import) » ; les valeurs, filtres et tris
compatibles sont conservés. Le support natif et la restauration gardée des vues
historiques sont suivis dans [036](../specs/036-multi-select-boards/spec.md).
Timeline, chart, form, map et
dashboard demanderaient une extension de MyOwnNotion.

Les synced blocks sont matérialisés ; leur synchronisation Notion n'est pas
reproduite. Un original non partagé devient un placeholder « inaccessible » et
un avis, avec sa référence conservée. Les colonnes sont mises en séquence.
Les bases enfants conservent leur présentation : `is_inline: false` devient un
lien vers la base native ; `true` garde un affichage intégré si sa vue est
représentable. Si l'indicateur manque ou aucune vue ne peut être affichée, la
base reste accessible par son lien ; un indicateur absent est signalé.
`/lien` permet de référencer une page, un dossier ou une base sans l'intégrer.
Les créations se nomment « Page imbriquée », « Dossier imbriqué » et « Base de
données imbriquée ». « Base de données intégrée » ouvre le choix entre une
nouvelle source et une source existante ; elle remplace l'entrée de vue liée.
Les équations conservent exactement leur source LaTeX et se rendent localement
avec KaTeX ; elles sont éditables, même si leur syntaxe est invalide ou dépasse
le sous-ensemble rendu. Les commandes de lien/HTML non fiables sont désactivées.
`/équation` crée un bloc mathématique et `/sommaire` un sommaire dérivé des
titres de la page. Les blocs inconnus restent des fallbacks lisibles, accompagnés
de leur représentation source. Les retours à la ligne des paragraphes deviennent des paragraphes
distincts ; les lignes supplémentaires d'une liste ou d'un toggle restent dans
ses sous-blocs. Les cellules de tableau et blocs de code gardent leurs sauts de
ligne. Le code en ligne garde le style code, exclusif dans notre format ; les
autres marques originales sont conservées et signalées. Les en-têtes de
tableau, icônes de fichier et certaines mises en forme sont signalés.
Les permissions d'équipe, commentaires et historique Notion ne sont pas importés.

Les médias hébergés sur les hôtes Notion autorisés sont téléchargés sans jeton.
Les autres médias restent des liens signalés. Une erreur de média conserve le
lien et produit un avis ; une erreur d'accès aux pages/schémas bloque la collecte.
Les fichiers ont une limite de 64 MiB, la collecte de 10 000 objets, profondeur
32 et 256 MiB de snapshot. Les téléchargements expirés doivent être recollectés
avant application ; une reprise a déjà les bytes enregistrés.

## Instance indépendante de développement

Ne pas lancer `dev:stack:reset` contre l'instance personnelle. Employer un nom
Compose, ports, volumes et secret de déploiement distincts, plus un checkout
indépendant. La validation de 028 utilise `myownnotion-notion-api`, HTTP 8082,
HTTPS 8445 et PostgreSQL 55433 ; elle n'utilise aucun volume de l'instance UI.
L'accès navigateur est `http://127.0.0.1:8082`, avec des cookies de développement
distincts du domaine localhost utilisé par l'instance UI.
Les options de stack et secrets locaux restent dans des répertoires ignorés.

## Différences à examiner pour faire évoluer l'application

Ces différences décrivent le modèle de MyOwnNotion et les conversions de cet
importeur. Elles ne supposent pas qu'un original JSON puisse reproduire un
comportement interactif absent de l'application.

| Élément Notion | Résultat dans MyOwnNotion | Évolution nécessaire pour une fidélité complète |
| --- | --- | --- |
| Bases, sources, lignes, options et relations accessibles | Objets natifs modifiables, sans fusion par titre | Aucune pour la structure prise en charge |
| Base directement imbriquée dans une autre base | Hiérarchie conservée ; la page de base enfant peut aussi être exposée comme entrée du parent par les parcours locaux fondés sur les enfants directs | Distinguer explicitement conteneur imbriqué et appartenance à une source dans ces parcours |
| Personne, auteur, dernier éditeur | Propriétés ignorées ; noms présents dans le texte conservés comme texte | Exclusion demandée par le propriétaire |
| Formules, rollups, fichiers de propriété, URL et métadonnées | Valeur figée en texte et original protégé | Nouveaux types de propriétés ; moteur de calcul pour formules et rollups |
| Dates avec fin/fuseau ou mélange date/instant | Début natif ; fin/fuseau conservés dans l'original ; date seule convertie à minuit UTC dans une colonne instant | Valeur date avec intervalle, fuseau et précision par valeur |
| Groupes de statuts, format de nombre | Options/couleurs et nombres natifs ; réglages originaux signalés | Groupes de statuts et formats de présentation |
| Vues table, Kanban, galerie, liste, calendrier | Vues natives quand compatibles ; requête incompatible remplacée par une table explicitement sans filtre | Filtres imbriqués/relatifs, contrôles rapides, sous-groupes et options de présentation manquantes |
| Timeline, graphiques, formulaires, cartes, tableaux de bord | Table de remplacement et configuration originale | Nouveaux types de vues |
| Blocs synchronisés et modèles | Contenu matérialisé ou page ordinaire ; original inaccessible explicitement indiqué | Réutilisation de blocs et modèles, plus partage Notion pour les originaux inaccessibles |
| Équations de bloc/en ligne et sommaires | Blocs/marks natifs avec source intacte, édition et rendu local ; sommaire actualisé | Commandes LaTeX hors du sous-ensemble KaTeX restent corrigeables comme source |
| Colonnes, blocs inconnus et certains embeds | Colonnes en séquence ; texte, lien ou placeholder avec original | Colonnes et nouveaux blocs/providers |
| Sauts de ligne dans un paragraphe, styles cumulés avec code | Paragraphes distincts ; style code seul | Extension du document canonique et de l'éditeur |
| Couvertures des pages et bases | Ignorées, sans téléchargement ni pièce jointe | Exclusion permanente du produit |
| Icônes de fichier | Pièces jointes lorsque téléchargeables ; emoji natif | Métadonnées d'icône correspondantes |
| Permissions, commentaires, historique, automatisations | Non importés | Fonctionnalités dédiées et accès API correspondant ; permissions d'équipe hors direction mono-propriétaire |

Dans la source testée le 2026-10-04, les schémas comportent notamment cinq
propriétés Personne, désormais ignorées, et une propriété de date de création,
convertie en texte.
Les limites de dates, blocs synchronisés, colonnes et filtres de vues
ont aussi été rencontrées. Formules et rollups sont pris en compte par la
conversion statique, mais aucun schéma de ce type n'a été observé dans ce test.
Les résultats et contrôles sont dans
[la validation de 028](../specs/028-notion-import/validation-api.md) et
[les corrections de contenu et listes de 034](../specs/034-notion-content-navigation/validation.md).
La correction du 4 octobre conserve Archive > Lycée > Simple Note, y compris
lorsque Notion utilise un parent `block_id` dans une colonne. People est exclue
explicitement de cette instance de test : neuf bases restent actives.
La correction 035 rétablit huit liens vers des bases enfants sur six pages,
dont CNAM → Suivi des tâches, et conserve la base réellement intégrée. Une
sauvegarde et une comparaison aux blocs initiaux précèdent la réparation ;
aucune base, source ou entrée n'est recréée. Voir [validation035](../specs/035-item-links-database-insertion/validation.md).

Deux limites viennent aussi de l'accès à la source : deux originaux de blocs
synchronisés sont inaccessibles à l'intégration et 35 blocs sont déclarés
`unsupported` par l'API. L'original conservé est la réponse reçue de l'API,
pas une copie de contenu que Notion n'a pas transmis. Étendre MyOwnNotion ne
suffirait donc pas à récupérer automatiquement ces contenus manquants.

## Références vérifiées

[Obsidian Importer](https://github.com/obsidianmd/obsidian-importer),
[guide Obsidian](https://help.obsidian.md/import/notion),
[versionnement Notion](https://developers.notion.com/reference/versioning),
[limites de requêtes](https://developers.notion.com/reference/request-limits),
[bases et sources](https://developers.notion.com/reference/retrieve-database),
[propriétés paginées](https://developers.notion.com/reference/retrieve-a-page-property),
[vues](https://developers.notion.com/reference/view).
