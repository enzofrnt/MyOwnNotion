# Validation — Fil d’Ariane, onglets ouverts et vue de dossier

**Date de renouvellement** : 2026-09-13  
**Runtime** : Bun 1.4.2  
**État** : implémentation et matrice locale validées ; livraison PR/`main` en cours

## Correctif issu de l’audit

Le bouton natif qui ferme chaque onglet possédait déjà un nom accessible et un
style de focus, mais `aria-hidden="true"` et `tabIndex={-1}` le retiraient de
l’arbre accessible et de l’ordre de tabulation. Ces deux exclusions ont été
supprimées. La bande utilise une `toolbar` nommée : ses destinations sont des
boutons ordinaires dont la destination active porte `aria-current="page"`, et
les boutons de fermeture restent des contrôles séparés et focusables. Cette
structure évite d’introduire un bouton non-`tab` dans un `tablist`, ce qui
violait le modèle ARIA. Entrée et Espace ferment une seule fois, sans
gestionnaire clavier ou `pointerdown` parallèle.

Les tests de `OpenTabsStrip` vérifient le nom du contrôle, son exposition, son
`tabIndex` natif, le focus réel, la fermeture sans activation parasite et la
restauration du focus sur la destination voisine après disparition du bouton,
y compris par ⌘W/Ctrl+W et clic central. Les flèches ne quittent pas un bouton
de fermeture. Quand la destination active est un fichier sans onglet, le
premier onglet reste dans l'ordre de tabulation et le raccourci de fermeture ne
ferme aucune destination étrangère. Fermer le dernier onglet rend le focus au
canevas avant le retrait de la bande. La cible reste compacte sur pointeur fin
et passe à 44 px sur pointeur grossier, valeur mesurée dans le parcours étroit.

La liste de dossier rend désormais de vrais liens vers les routes canoniques :
les gestes navigateur avec modificateur restent disponibles, tandis que le clic
simple emprunte la navigation commune. Elle joint le registre local des sources
de base à la hiérarchie afin d’afficher une base placée comme « Base de données »
avec son icône de table, au lieu de l’annoncer comme une page.

Le [skill UI partagé](../../.agents/skills/ui-quality/SKILL.md) est référencé
par le plan et T043. La revue applique ses règles aux boutons sémantiques, aux
cibles, aux tokens d'espacement et d'arrondi, au focus visible, au défilement
interne et aux largeurs minimales produit.

## Parcours T040

`tests/e2e/workspace-tabs-folder.spec.ts` construit une hiérarchie profonde et
vérifie dans un même parcours :

- l’ajout et l’activation des onglets sans doublon ;
- le précédent/suivant navigateur, la restauration après rechargement et la
  mise à jour immédiate après renommage, emoji et conversion page → dossier ;
- le repli mesuré des ancêtres intermédiaires et leur ordre dans le menu « … » ;
- le canevas de dossier, sa liste d’enfants et l’absence d’éditeur dans cette
  surface, ainsi que l’identité visuelle d’une source de base placée et un audit
  axe WCAG 2 A/AA sans violation critique ou sérieuse ;
- le déplacement d’un enfant par action tactile sur les profils mobiles, par
  pointeur glissé sur les profils desktop et par le capteur clavier sur toute
  la matrice, chaque fois reflété dans la liste et dans l’arbre canonique après
  synchronisation, puis vérifié depuis un second appareil ;
- la fermeture au clavier d’un onglet inactif puis actif, avec conservation ou
  sélection correcte de la destination et focus rendu au bouton voisin ;
- une seule ligne d’onglets défilante, des cibles tactiles de fermeture et de
  réordonnancement d’au moins 44 px et aucun débordement du document après les passages de 1024 × 800 à
  390 × 844 puis 320 × 844 ; le tiroir mobile ouvre réellement le menu de la
  ligne au sixième niveau à 320 px et mesure sa cible à 44 px.

Preuves locales ciblées :

| Contrôle | Résultat |
| --- | --- |
| tests composants onglets/dossier/icônes, Bun 1.4.2 | 3 fichiers, 23 tests réussis (dont 11 onglets) |
| contrat d’inventaire et d’impact CI | 37 tests réussis |
| parcours 022, Chromium desktop isolé | 1 parcours réussi |
| parcours 022, Chromium desktop répété | 5/5 répétitions réussies en 27 s |
| parcours 022, matrice complète séquentielle finale | 5/5 projets réussis en 96 s |
| `bun run desktop:check` après correction ARIA | build, package, smoke installé et parcours Electron réussis |

La matrice complète comprend `chromium-desktop`, `firefox-desktop`,
`webkit-desktop`, `chromium-mobile` et `webkit-mobile`. Firefox et WebKit ont
été exécutés dans le conteneur Linux épinglé requis sur macOS.
Le parcours renouvelé vérifie le profil tactile directement à 320 px, puis 390
et 320 px pour la bande dans chaque projet. Le CSS de navigation profonde et
les sources workspace/hierarchy sont déclarés dans `ci/test-impact.json`; le
contrat vérifie à la fois l’inventaire exhaustif des fichiers E2E et la sélection
du parcours 022 et du parcours d’accessibilité lorsqu’une de ces surfaces change.

## Livraison

Le candidat intégré précédent `52dfdc926164f392cf812ead302bddb9662ac356`
a passé la PR #175 (`34747879571`) et a été fusionné normalement en
`4d9d3b0cf2fdfd8d83319c688177d972e8a45b3f`. Son run `main` `34748994269`
a toutefois échoué sur le débordement Firefox A82. Cette PR verte prouve
l'intégration antérieure, mais elle ne contient pas les corrections A81–A85
documentées ci-dessus. Le commit exact de ces corrections, sa PR et son run
`main` restent à consigner avant de fermer T044.
