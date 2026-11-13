# Référence fonctionnelle Notion — Formule, Agrégation et Lieu

Relevé documentaire des sources officielles Notion consultées le 11 novembre 2026. Ce document distingue le comportement **documenté** de ce qui reste **non établi** ; il ne remplace pas les décisions de périmètre du projet. Les noms anglais ci-dessous sont les libellés ou identifiants des sources, pas une traduction supposée de l'interface française. Une capture seule prouve un état visuel observé à un moment donné, pas une règle générale.

## Formule

### Documenté : types et syntaxe

La [référence de syntaxe Notion](https://www.notion.com/help/formula-syntax) précise que les types de formule diffèrent des types de propriété :

| Propriété source | Type exposé dans une formule | Exemple documenté |
| --- | --- | --- |
| Titre, texte, sélection, e-mail, URL, téléphone, identifiant unique | Texte | `prop("Priority") == "High"` |
| Sélection multiple | Liste de textes | `prop("Tags").includes("Finance")` |
| Case à cocher | Booléen | `not prop("Checkbox")` |
| Nombre | Nombre | `prop("Number") / 2` |
| Date, date de création, dernière modification | Date | `prop("Due Date") > now()` |
| Créé/modifié par | Personne | `prop("Created By").name()` |
| Personne | Liste de personnes | `prop("Person").map(current.email())` |
| Relation | Liste de pages | `prop("Tasks").length()` |
| Agrégation | Nombre, date ou liste de tout type selon sa configuration | `prop("Average cost") * 12` |

La formule référence une propriété par `prop("Nom")` ; la documentation utilise aussi la notation de propriété directement dans l'éditeur et la notation chaînée, par exemple `Tasks.length()`. `+`, `-`, `*`, `/`, `%`, `^`, comparaisons `==`, `!=`, `>`, `>=`, `<`, `<=`, `and`/`&&`, `or`/`||`, `not`/`!` et `condition ? valeurSiVrai : valeurSiFaux` sont illustrés dans la [syntaxe](https://www.notion.com/help/formula-syntax) et l'[introduction](https://www.notion.com/help/formulas). `if(true, 1, 2)` vaut `1` ; `ifs(false, 1, false, 2, 3)` vaut `3`.

### Catalogue utilisable et exemples exacts

La liste et les signatures complètes, susceptibles d'évoluer, font foi dans la [référence officielle des fonctions](https://www.notion.com/help/formula-syntax#functions). Les exemples suivants définissent des formes attestées, **pas** l'ensemble des surcharges possibles :

| Famille | Fonctions et formes attestées |
| --- | --- |
| Contrôle et variables | `if(condition, vrai, faux)`, `ifs(condition1, valeur1, condition2, valeur2, défaut)`, `let(person, "Alan", "Hello, " + person + "!")`, `lets(a, "Hello", b, "world", a + " " + b)` |
| Vide, texte et regex | `empty(0)`, `length("hello")`, `substring("Notion", 0, 3)`, `contains("Notion", "ot")`, `test("Notion", "Not")`, `match("Notion Notion", "Not")`, `replace("Notion Notion", "N", "M")`, `replaceAll("Notion Notion", "N", "M")`, `lower`, `upper`, `repeat("0", 4)`, `trim`, `format(1234)` |
| Présentation | `link("Notion", "https://notion.so")`, `style("Notion", "b", "u")`, `unstyle("Text", "b")` ; styles `b`, `u`, `i`, `c`, `s` ; couleurs `gray`, `brown`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`, `red`, avec suffixe `_background` pour le fond |
| Nombres | `add`, `subtract`, `multiply`, `divide`, `mod`, `pow` ; `min(1, 2, 3)`, `max([1, 2, 3])`, `sum([1, 2, 3], 4, 5)`, `median([1, 2, 3], 4)`, `mean(1, 2, 3)` ; `abs`, `round`, `ceil`, `floor`, `sqrt`, `cbrt`, `exp`, `ln`, `log10`, `log2`, `sign`, `pi()`, `e()`, `toNumber` |
| Dates | `now()`, `today()`, `minute`, `hour`, `day`, `date`, `week`, `month`, `year`, `dateAdd(now(), 1, "days")`, `dateSubtract(now(), 1, "days")`, `dateBetween(date1, date2, "days")`, `dateRange`, `dateStart`, `dateEnd`, `timestamp`, `fromTimestamp`, `formatDate(now(), "MM/DD/YYYY")`, `parseDate("2022-01-01")` |
| Listes et objets | `at([1, 2, 3], 1)`, `first`, `last`, `slice([1, 2, 3], 1, 2)`, `concat`, `join`, `split`, `unique`, `includes`, `find`, `findIndex`, `filter`, `some`, `every`, `map`, `flat`, `id()`, `name`, `email` ; `equal`, `unequal` |

Points précis utiles aux tests, tous issus de la [référence](https://www.notion.com/help/formula-syntax#functions) :

- `empty(0)`, `empty("")` et `empty([])` sont vrais : ne pas assimiler cette fonction à une simple vérification de valeur absente.
- `substring("Notion", 0, 3)` vaut `"Not"` : début inclus, fin facultative exclue. `replace` remplace la première correspondance regex, `replaceAll` toutes ; `match` renvoie une liste.
- `median([1, 2, 3], 4)` vaut `2.5` ; `round(1234, -2)` vaut `1200`.
- `day` donne le jour de semaine de 1 lundi à 7 dimanche ; `date` le jour du mois ; `month` va de 1 à 12. `dateBetween` peut être négatif ; ses unités documentées sont `years`, `quarters`, `months`, `weeks`, `days`, `hours`, `minutes`. `parseDate` utilise ISO 8601 ; `fromTimestamp` prend des millisecondes Unix et ne conserve pas secondes ni millisecondes dans la date retournée.
- `map([1, 2, 3], current + index)` donne `[1, 3, 5]` ; `filter([1, 2, 3], current > 1)` donne `[2, 3]`. `find([1, 2, 3], current > 100)` donne `Empty` ; `findIndex` dans ce cas donne `-1`. `at([1, 2, 3], 1)` vaut `2`.
- La documentation indique qu'il n'existe pas de fonction `random()` dans les formules Notion : [introduction](https://www.notion.com/help/formulas).

### Matrice de départ pour l'agent d'implémentation

Comparaison documentaire avec le code du répertoire de travail le 11 novembre
2026, **non exécutée** et non exhaustive. La présence d'un nom dans le code ne
prouve ni sa conformité, ni son accessibilité sur toutes les surfaces ; écrire
les tests avant correction. Les comportements Notion proviennent de la
[référence officielle](https://www.notion.com/help/formula-syntax#functions).

| Cas de test | Attendu documenté par Notion | Lecture statique du code MyOwnNotion | Point à traiter |
| --- | --- | --- | --- |
| `empty(0)` | `true` | `empty` ne teste que `null` et chaînes blanches : `false`. | Différencier valeur vide métier et zéro selon contrat Notion ; tester aussi `empty("")` et `empty([])`. |
| `round(1234, -2)` | `1200` | Les décimales sont bornées entre 0 et 10 : l'argument `-2` devient 0. | Gérer les arrondis à gauche de la virgule, puis vérifier arrondis aux égalités. |
| `replace("abc", "a.", "X")` | `"Xc"` si `a.` est interprété comme motif regex conformément à l'aide. | `String.replace` reçoit une chaîne littérale, donc ne correspond pas à `a.`. | Vérifier la compatibilité exacte des motifs et borner leur coût avant d'adopter des regex. |
| `map([1, 2, 3], current + index)` | `[1, 3, 5]` | Pas de branche `map` dans l'évaluateur ; le type de sortie actuel ne représente pas les listes. | Définir valeurs et syntaxe de listes et expressions à portée locale, pas uniquement ajouter un libellé. |
| `prop("Tasks").length()` | Une relation est une liste de pages. | `propertyValue` convertit une relation en nombre de cibles. | Préserver les pages/références typées et aligner la navigation de propriétés liées. |
| `prop("Average cost") * 12` | La propriété d'agrégation peut renvoyer nombre, date ou liste selon son calcul. | La branche `rollup` renvoie le nombre de relations. | Propager le résultat typé réel et tester avec une somme distincte du nombre de liens. |

Fichiers de base : `apps/web/src/features/databases/formula.ts` (résolution de
propriétés et fonctions), `formula-editor.tsx` (liste visible),
`packages/domain/src/databases/rollup.ts` (agrégations). Voir également les
écarts de surface et de pagination dans [audit-reprise.md](audit-reprise.md).

### Limites et erreurs documentées

Les formules ont une profondeur maximale de **15 niveaux** : chaque référence à une autre formule ou agrégation ajoute un niveau, même entre bases ; une erreur apparaît à la limite. Le défaut d'accès à une base référencée peut rendre le calcul non fiable. Dans les **automatisations**, le type de retour attendu et les valeurs indéfinies peuvent bloquer ou mettre en pause l'exécution : ne pas généraliser ces conséquences à toutes les propriétés de formule. L'aide recommande, pour une date potentiellement vide dans une automatisation, `if(Date, Date.dateAdd(1, "day"), empty())` ; les relations et personnes sont des listes à traiter avec `first()`/`at(0)` ou à parcourir. Source : [erreurs de formule](https://www.notion.com/help/common-formula-errors).

**Non établi ici :** sémantique exacte de division par zéro, arrondi aux égalités, propagation de toutes les erreurs, circularité, actualisation de `now()`, locale/fuseau dans tous les cas, types et coercitions de Lieu dans les formules. La présence d'une fonction dans le catalogue ne démontre pas l'acceptation de tous les types d'arguments imaginables.

## Agrégation / rollup

### Configuration et résultats documentés

Une agrégation associe **une relation**, **une propriété de la base liée** et **un calcul**. Elle agrège les valeurs des pages liées ; l'API donne les identifiants/noms de ces deux propriétés et rend la valeur de page en lecture seule. Le partage de la base liée avec la connexion compte : sinon les relations peuvent apparaître vides et les résultats de formules/agrégations incomplets. Sources : [relations et agrégations](https://www.notion.com/help/relations-and-rollups#rollups), [schéma API](https://developers.notion.com/reference/property-object#rollup).

L'aide Notion décrit les **18 libellés** suivants ([Rollup types](https://www.notion.com/help/relations-and-rollups#rollup-types)) :

| Portée indiquée | Libellé officiel | Signification documentée |
| --- | --- | --- |
| Général | `Show original` | Montre les pages liées dans la même cellule ; l'aide l'assimile à la relation elle-même. |
| Général | `Show unique values` | Chaque valeur unique de la propriété sélectionnée parmi les pages liées. |
| Général | `Count all` | Nombre total de valeurs de la propriété sélectionnée pour les pages liées. |
| Général | `Count values` | Nombre de valeurs non vides de cette propriété. |
| Général | `Count unique values` | Nombre de valeurs uniques. |
| Général | `Count empty` / `Count not empty` | Nombre de pages liées ayant respectivement une valeur vide / renseignée. |
| Général | `Percent empty` / `Percent not empty` | Pourcentage de pages liées ayant respectivement une valeur vide / renseignée. |
| Propriété Number | `Sum`, `Average`, `Median`, `Min`, `Max`, `Range` | Somme, moyenne, médiane, minimum, maximum, différence `Max - Min`. |
| Propriété Date | `Earliest date`, `Latest date`, `Date range` | Date/heure la plus ancienne, la plus récente, intervalle entre les deux. |

**Exemple :** trois achats liés ont des prix renseignés 10, 20 et un prix vide : `Count empty` = 1, `Count not empty` = 2, `Percent empty` = 1/3 et `Range` = 10. L'aide définit ces catégories ; elle ne précise pas ici l'arrondi affiché de 1/3. Attention : les termes « valeurs » et « pages » utilisés par l'aide ne suffisent pas à inférer le traitement exact des listes multi-valeurs.

Notion indique que les agrégations ne peuvent être **triées que lorsque leur sortie est numérique**. Une agrégation d'agrégation n'est pas prise en charge. Les calculs appliqués à une colonne d'agrégation sur toute une table ou un tableau sont une fonctionnalité distincte du calcul par page. Source : [relations et agrégations](https://www.notion.com/help/relations-and-rollups#rollup-types).

### Les 24 identifiants API ne prouvent pas 24 options UI

Le [schéma API officiel](https://developers.notion.com/reference/property-object#rollup) énumère exactement : `count`, `count_values`, `empty`, `not_empty`, `unique`, `show_unique`, `percent_empty`, `percent_not_empty`, `sum`, `average`, `median`, `min`, `max`, `range`, `earliest_date`, `latest_date`, `date_range`, `checked`, `unchecked`, `percent_checked`, `percent_unchecked`, `count_per_group`, `percent_per_group`, `show_original`. Les six identifiants `checked`, `unchecked`, `percent_checked`, `percent_unchecked`, `count_per_group`, `percent_per_group` n'ont pas de description correspondante parmi les 18 libellés de l'aide ci-dessus. Une fonction peut être configurable dans le schéma sans pouvoir être calculée par la récupération d'un property item : consulter les limites de l'[API property item](https://developers.notion.com/reference/retrieve-a-page-property). Une réponse d'agrégation paginée doit être lue jusqu'au bout avant d'utiliser le résultat ; cette contrainte est celle de l'API, pas une limite UI présumée.

**Non établi ici :** équivalence exhaustive entre les 24 identifiants et les libellés de menu, disponibilité exacte par type/version, calculs sur zéro page, valeurs vides ou multi-valeurs, ordre/dédoublonnage des listes, et filtres par type de résultat. Il faut des essais ciblés pour les comportements ; captures des menus et résultats pour l'apparence et l'ordre visibles.

## Lieu et carte

### Documenté

Selon l'[aide Carte](https://www.notion.com/help/maps) :

- Une propriété `Place` se renseigne via l'accès à la position actuelle, un nom de lieu ou une adresse. La recherche d'adresse transmet la requête à **un fournisseur tiers** ; la qualité et la couverture varient selon les régions. Le nom du fournisseur n'est pas précisé dans cette source : le choix Google du projet n'est donc pas une identification documentée de celui de Notion.
- Convertir une propriété texte contenant des adresses en Lieu peut nécessiter un nettoyage des adresses pour leur bon affichage sur la carte.
- Une vue Carte exige une propriété Lieu ; si elle n'existe pas lors de la création de la vue, Notion en crée une. `/map` crée une vue ; dans une base existante, ajouter une vue `Map`.
- La carte montre **au plus 100 éléments simultanément**. Pour davantage de lieux, l'aide suggère de filtrer ou de répartir entre plusieurs vues. Ce n'est pas une limite documentée du nombre de lieux stockés dans la base.
- Cliquer sur une épingle ouvre la page correspondante ; on peut zoomer et déplacer la carte. En présence de plusieurs propriétés Lieu, choisir `Layout` → `Map by` pour déterminer celle qui alimente la vue.
- Les filtres et tris Lieu sont **textuels** : filtrage sur le texte contenu dans le nom ou l'adresse, tri alphabétique. La recherche de base de données est différente : elle trouve les entrées dont le **titre de page** contient la requête, selon l'[aide Recherche](https://www.notion.com/help/search). Ne pas confondre filtre Lieu, recherche d'adresse et recherche de base.
- Si des épingles manquent : vérifier la correspondance des adresses à un lieu et la propriété `Map by`. Le calcul de distance entre deux lieux n'est pas disponible selon la FAQ de cette aide.

**Exemple :** une base comporte `Bureau` et `Client` comme propriétés Lieu ; la carte réglée sur `Map by → Client` représente les adresses client, et un filtre textuel contenant `Paris` peut porter sur le nom ou l'adresse. Au-delà de 100 entrées visibles, utiliser des filtres ou plusieurs vues.

**Non établi ici :** fournisseur exact, algorithme de classement/autocomplétion, délai et seuil de recherche, coordonnées ou identifiant persistés, saisie libre en cas d'absence de résultat, gestion du refus de géolocalisation et du mode hors ligne, casse/accents du filtre, ordre de sélection des 100 éléments, regroupement des épingles et comportement d'adresses identiques. Ne pas les déduire du seul texte officiel.

## Éléments nécessitant des captures de référence

Les sources textuelles ne démontrent pas à elles seules la parité visuelle. Capturer avec version, date, plateforme, langue, thème et données de test :

1. Éditeur Formule : disposition, palette, recherche et documentation, sélection de propriété/fonction, aperçu, débogage, type, messages d'erreur et états vide/valide/invalide ; menus ouverts, focus, clavier, clair/sombre et mobile.
2. Agrégation : sélecteurs relation/propriété/calcul, ordre et libellés effectivement visibles pour texte, nombre, date, case et état ; rendu liste/nombre/date/vide et restrictions du tri. Une capture par configuration prouve seulement le menu observé pour celle-ci.
3. Lieu : saisie et suggestions, attente, aucun résultat, permission refusée, position actuelle, suppression et affichage cellule ; carte vide/épingles, ouverture de page, choix `Map by`, zoom et filtrage. Les résultats du fournisseur et la disponibilité varient selon région et données.

Les captures complètent des interactions et jeux d'essai reproductibles ; elles ne démontrent ni le fournisseur, ni les limites générales, ni le stockage interne.
