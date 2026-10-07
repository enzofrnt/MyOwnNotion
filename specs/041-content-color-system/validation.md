# Validation — Couleurs de contenu

2026-10-07. Périmètre : 041, contrôles ciblés et revue manuelle. Les E2E et
le gate global sont explicitement différés par le propriétaire. Cette passe
ne valide pas les changements de démarrage 039/040 ni toute la branche.

## Référence et résultat

Lecture réelle de l’onglet Notion fourni : fonds, accents, badges, contours,
survol et géométrie dans [research.md](research.md). Mesures sombres seulement ;
aucune affirmation sur son algorithme interne ou sa palette claire.

La nouvelle recette partage neuf accents et des coefficients par thème.
Les colonnes sont moins présentes que les cartes, elles-mêmes moins saturées
que les badges. Le contour de carte/création est translucide et mesure 1 px.
Les points restent distincts du texte de commande et du texte éditorial.
Les rayons historiques locaux (carte 8 px, colonne 14 px) sont conservés ;
le rayon de carte Notion mesuré à 10 px n’a pas déclenché de refonte de layout.

La revue a détecté deux consommateurs incorrects, corrigés avant le dernier
déploiement : OptionTonePicker utilisait encore le texte éditorial comme point,
et les textes de création clairs utilisaient un accent insuffisamment contrasté.
Le rôle commun `-foreground` conserve l’accent sombre et le mélange au texte
principal en clair. Calcul de contrôle sur les recettes claires : jaune au
moins 4,85:1 sur les deux fonds colonne/carte, contre environ 2,1:1 avant ;
ce calcul ciblé ne constitue pas un audit d’accessibilité global.

## Revue manuelle réelle

Navigateur intégré, runtime web 8082 après recompilation. Aucune modification
de donnée propriétaire, aucune conversion ni création pendant la revue.

| Surface / état | Preuve et observation |
| --- | --- |
| Kanban réel sombre / clair, 970 × 909 | `041-app-after-dark.jpg`, `041-app-after-light.jpg` : colonnes neutre/bleue/verte, badges, commandes et contours discrets. Badge rose sur carte verte et badge gris sur carte bleue conservent leur propre ton. |
| Survol d’azdadz | `041-hover-dark.json`, `041-app-hover-dark.jpg` : fond sRGB `(0.10902,0.181176,0.252549)` → `(0.124096,0.206231,0.287473)` ; position `(334,323.59375)`, largeur 268, hauteur 68 et bordure 1 px identiques avant/après. |
| Focus clavier | `041-focus-dark.jpg` : Tab depuis le crayon, bouton Actions de azdadz avec `:focus-visible`, contour neutre solide 1 px ; aucune écriture. |
| Édition | `041-app-edit-dark.jpg`, `041-app-mobile-edit-dark.jpg` : titre sans cadre, propriétés supplémentaires et Page/Dossier dérivé du support. Fermeture par Échap sans changement de valeur. |
| 320 × 909 | `041-app-mobile-light.jpg`, `041-app-mobile-blue-light.jpg`, `041-app-mobile-dark.jpg` : `innerWidth`, body et document `scrollWidth` = 320. Scrollport de Kanban 304 px / contenu 1068 px ; molette horizontale à 276 px déplace la colonne sans faire déborder le document. |
| Neuf tons | `041-palette-dark.jpg`, `041-palette-light.jpg` : neuf surfaces, contours, repères et choix actif au laboratoire. |
| Sélecteur de propriété / nom long | `041-properties-dark.jpg`, `041-properties-light.jpg`, `041-properties-mobile-dark.jpg` : repères conformes aux neuf accents ; option longue et choix actif lisibles, rangée mobile contenue. |
| Éditeur | `041-editor-dark.jpg`, `041-editor-light.jpg` : callout bleu utilise `-soft`, texte conservé lisible ; code, citation et tableau restent sur leurs surfaces sémantiques. |
| Table / vide / désactivé | `041-table-dark.jpg`, `041-empty-dark.jpg` : badges table identiques aux rôles du Kanban ; zéro carte dans l’exemple vidé, groupes conservés ; bouton Chargement désactivé atténué. Actions confinées au laboratoire. |

Les fichiers ci-dessus sont des preuves locales privées sous `work/notion-api/`.
Les captures mobiles finales utilisent un clip CDP 320 × 909 : l’API de capture
intégrée réduisait autrement le viewport physique au lieu de le cadrer.
Viewport et thème système restaurés, page Suivi des tâches réouverte,
aucun éditeur laissé ouvert. Le fallback sombre a été comparé statiquement
au thème explicite ; pas de désactivation du bootstrap dans l’instance.

## Contrôles et déploiement

- Biome sur les cinq fichiers CSS/TSX touchés par 041 : sortie 0, 52 avertissements
  CSS de spécificité/`!important`, aucun diagnostic bloquant. `041-biome.log`.
- `bun run --filter @myownnotion/web typecheck` : sortie 0. `041-types.log`.
- `bun run --filter @myownnotion/web build` : sortie 0, Bun 1.4.2,
  33 sorties web et 23 assets précachés. `041-build.log`.
- Image de développement épinglée Bun 1.4.2 construite, puis
  `compose ... up --no-deps --no-build --pull never --force-recreate --wait web`.
  `041-image-build.log` / `041-deploy.log` : web sain.
- Dernier démarrage web 8082 : `2026-10-07T13:40:00.158287834Z`.
  Comparaison `041-runtime-before.txt` / `041-runtime-after.txt` : seul web 8082
  redémarré. API, PostgreSQL, Caddy 8082 et tous les services 8080 inchangés.
- `git diff --check` : passe. Aucun commit, push ou changement de seuil de tests.

## Limites et convergence

FR001–006 et SC001–003 couverts par les mesures, le contrat de tokens, les
consommateurs et la revue réelle ci-dessus. Pas d’écart matériel UI dans le
périmètre de cette passe. Les anciennes preuves de couleur 038 sont historiques ;
son comportement et ses autres critères restent en vigueur.

Les E2E, la matrice multi-moteur et le gate complet ne sont pas relancés.
Les contrôles de 040 gardent leur statut dans ses propres artefacts ; aucun
résultat partiel n’est transformé en validation globale. Le rendu clair de
Notion n’a pas été mesuré : le clair de l’application suit notre recette
commune, vérifiée manuellement.
