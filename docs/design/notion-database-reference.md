# Référence Notion — bases de données

Relevé fait le 2026-11-04 dans l'espace de test du propriétaire, via la cabine
de mesure locale (`scripts/notion-lab`). Les captures brutes restent dans
`.notion-lab/captures/` (ignoré par Git : elles contiennent l'interface Notion).

Espace vérifié : pages `Emmy`, `Test Codex sources et vues`, `adzlkadk`, `Base`,
`ponpnno`. Aucune note personnelle (lycée, CNAM) n'était visible.

## Types de propriétés observés

Menu « Ajouter une propriété » de la table Notion, libellés français :

| Libellé Notion | Type interne | État MyOwnNotion |
| --- | --- | --- |
| Texte | text | pris en charge |
| Numéro | number | pris en charge |
| Sélecteur | select | pris en charge |
| Sélection multiple | multi-select | pris en charge |
| État | status | pris en charge (sans groupes) |
| Date | date | pris en charge (sans plage) |
| URL | url | livré (042) |
| Téléphone | phone | livré (042) |
| E-mail | email | livré (042) |
| Case à cocher | checkbox | pris en charge |
| Relation | relation | pris en charge |
| **Fichiers et médias** | files | **livré** (046) |
| **Formule** | formula | **livré** (045) |
| **Agrégation** (rollup) | rollup | **livré — compter** (047) |
| **Bouton** | button | **manquant** |
| **Identifiant** | unique-id | **livré** (048) |
| **Lieu** | place | **manquant** |
| **Date de création** | created-time | **livré** (044) |
| **Dernière modification** | last-edited-time | **livré** (044) |
| Personne | person | **exclu** (mono-utilisateur) |
| Créé par / Modifié par | created-by, last-edited-by | **exclus** (mono-utilisateur) |

Deux entrées du menu ne sont pas des types : « Résumer » et « Traduire »
(remplissage automatique par l'IA).

### Constats de comportement

- **Identifiant** : entier auto-incrémenté par base, lecture seule, une seule
  propriété Identifiant par base (l'entrée du menu est grisée quand elle existe
  déjà). Valeurs observées : 23, 22, 21… jusqu'à 5.
- **Fichiers et médias** : le menu de cellule propose deux onglets, « Charger »
  et « Lien ». « Charger un fichier » ouvre le sélecteur système ; le collage
  (`⌘V`) est accepté. Libellé d'invite : « Ajouter un fichier ou une image ».
- **Formule** : affichée en lecture seule dans la cellule ; la configuration
  s'ouvre par le menu de la propriété.
- **Relation** : pastille de page liée dans la cellule.
- **Bouton** : pastille « Bouton » dans chaque cellule.
- **Date de création / Dernière modification** : présentes dans le menu mais
  grisées dans cette base liée ; à revérifier dans une base à source propre
  avant de conclure à une indisponibilité.

## Mesures d'interface (thème clair, 1440 px)

| Élément | Valeur mesurée |
| --- | --- |
| Largeur utile de la table | 1736 px, défilement horizontal local |
| Marge interne de la vue | 96 px gauche/droite |
| Colonne de titre | 280 px |
| Colonnes de propriété | 200 px |
| Hauteur de l'en-tête | 36 px |
| Hauteur de ligne | 37 px |
| Texte d'en-tête | 14 px / 400, `rgb(125,122,117)` |
| Bordure de cellule | 1 px `rgba(42,28,0,0.07)` |
| Ombre sous l'en-tête | `rgba(42,28,0,0.07) 0 -1px 0 inset` |
| Bandeau d'onglets | 40 px de haut, pilule active |
| Ligne « Nouvelle page » | 28 px, alignée au texte |
| Bouton « Nouveau » | primaire bleu, séparé en deux (action + chevron) |

Repères complémentaires : barre d'outils à droite des onglets (filtre, tri,
automatisation, IA, recherche, réglages), puis « Nouveau ». L'en-tête n'a qu'une
bordure basse ; pas de séparateurs verticaux entre colonnes.

## Ordre d'implémentation proposé

1. **Fichiers et médias** — le type manquant le plus utilisé ; réutilise les
   fichiers canoniques et l'upload existants.
2. **Date de création / Dernière modification** — lecture seule ; nécessite
   d'exposer `items.createdAt/updatedAt` dans la requête de base.
3. **Identifiant** — compteur par source, rétro-remplissage des lignes.
4. **Formule** — petit moteur d'expression sûr, calcul à la lecture.
5. **Agrégation** — dépend des relations existantes.
6. **Bouton** — système d'actions, plus tard.
7. **Lieu** — géolocalisation, plus tard.

## Recapturer

```sh
bun run notion:capture -- --url "<url de la base>" --theme light --width 1440
```

Pour un état interactif (menu, cellule ouverte), un court script Playwright
sous `.notion-lab/` suffit ; ne pas versionner les captures.
