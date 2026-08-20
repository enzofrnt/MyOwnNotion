# Validation — Feature 009

## Checkpoint US1 — collection structurée de pages

**Date**: 2026-08-20

**Résultat**: réussi

Le parcours MVP crée une base comme capacité d'une page canonique, ajoute les
huit types de propriété requis, crée une entrée qui reste une page éditoriale,
enregistre ses valeurs et conserve une relation après renommage et déplacement
de sa cible. Aucun `ItemKind` supplémentaire n'a été introduit.

### Preuves exécutées

| Couche | Preuve | Résultat |
| --- | --- | --- |
| Domaine | Parsing strict, normalisation et rejeu des quatre commandes structurées | 12 tests réussis |
| PostgreSQL | Création, appartenance unique, relations, conversion, rollback et conservation des snapshots | 6 tests réussis |
| API propriétaire | Création/lecture/remplacement de base et d'entrée, aperçu d'impact et erreurs sûres | 4 tests réussis |
| Projection locale | Commit optimiste atomique, préparation crypto hors transaction, rollback et rejeu | 4 tests réussis |
| React | Formulaire, schéma, saisie refusée conservée, valeur décimale et panneau d'entrée | 5 tests réussis |
| Navigateur | Création, huit types, entrée-page, valeurs, relation, renommage et déplacement | 5 profils réussis |

Le parcours navigateur a terminé en 1,8 à 4,2 secondes selon le profil, sous la
limite fonctionnelle de cinq minutes. Il a réussi sur Chromium desktop/mobile,
WebKit desktop/mobile et Firefox desktop dans le conteneur Linux documenté.

### Identités et stockage protégé

- `databaseId === itemId` pour la page hôte ; l'entrée réutilise pareillement
  son `entryId` comme identité de page.
- Le renommage et le déplacement de la cible ne modifient pas l'identité
  stockée par la propriété relation ; le picker résout ensuite le nouveau nom.
- La définition et les valeurs sont scellées avant leur écriture dans les
  projections serveur et navigateur. Les tables structurelles ne portent que
  les identités, versions, états et clés nécessaires aux requêtes.
- Les échecs d'outbox, les fins de transaction injectées et les rejeux ne
  laissent ni demi-base ni doublon observable.

### Corrections issues du parcours réel

- Les imports CommonJS de `decimal.js-light` utilisent désormais un pont ESM
  explicite, vérifié par l'exécution native des migrations et pas seulement par
  le bundler de tests.
- Les requêtes partageant un client PostgreSQL transactionnel sont séquentielles,
  conformément au comportement requis par pg 9.
- Un accusé serveur qui remplace une révision locale pendant une saisie peut
  être rejoué sans perdre le brouillon ; un véritable changement concurrent de
  définition ou de valeurs reste refusé.

## Checkpoint US2 — vues table et liste enregistrées

**Date**: 2026-08-20
**Résultat**: réussi

Une même base est consultée et modifiée dans des vues table et liste sans
dupliquer ses entrées. Les vues enregistrent leur nom, ordre, colonnes,
largeurs, filtres ALL/ANY, tris ordonnés et regroupement. La sélection de vue,
la position interne et le retour de focus survivent à l'ouverture d'une
entrée ; un second navigateur retrouve le même résultat canonique.

### Preuves exécutées

| Couche | Preuve | Résultat |
| --- | --- | --- |
| Projection serveur | Génération atomique, index présence/égalité, upsert, invalidation et reconstruction | 4 tests réussis |
| Contrat API | Query, pagination sans doublon, curseur signé lié à la vue, cursor-stale et degraded | 6 tests réussis |
| Mutation batch | Mise à jour post-commit de la projection après une écriture offline | 10 tests de réconciliation réussis |
| Projection locale | Résultat complet/partiel, parité d'ordre et recalcul après commit | 3 tests réussis |
| Domaine | ALL/ANY, titre contient, tri stable, groupes et opérandes typés | 6 tests réussis |
| React | Barre de vues, période de dates, historique de position, table ARIA et liste sémantique | 8 tests US2 réussis |
| Navigateur | Édition de cellule, filtres, tri, groupe, colonnes, renommage, reload, focus et second appareil | 5 profils réussis |

La matrice navigateur a réussi sur Chromium desktop/mobile, WebKit
desktop/mobile et Firefox desktop dans le conteneur Linux documenté.

### Parité, couverture et persistance

- Le moteur local et la projection serveur utilisent la même définition
  enregistrée et le même départage stable par identité. Un résultat local
  partiel annonce `X/Y` et ne présente jamais son absence ou ses groupes comme
  exhaustifs.
- Les curseurs sont opaques, authentifiés et liés à la base, à la vue, à la
  révision de définition et à la génération. Un curseur périmé recharge la
  première page sans exposer le curseur refusé.
- La table suit le modèle ARIA grid à un seul point d'entrée, flèches,
  Home/End, Entrée/F2, Échap, annonce d'édition et commandes explicites de
  redimensionnement. Les cellules typées peuvent être modifiées directement.
- Le contexte de vue est conservé par onglet sans saturer l'API History de
  WebKit ; le scroll interne et la sélection sont restaurés avant le retour de
  focus. La liste garde une structure native.
- Une projection qui échoue au démarrage reste reconstructible : la première
  mutation confirmée réapplique les changements après commit, et la remise à
  zéro E2E supprime explicitement les anciennes enveloppes protégées.

### Corrections issues de la matrice réelle

- Les mutations batch alimentent désormais la projection structurée comme les
  routes unitaires ; auparavant un client offline pouvait rester bloqué sur
  une projection degraded vide.
- Les contextes de scroll utilisent un stockage de session et limitent les
  écritures History aux changements d'URL. WebKit refusait plus de cent
  `replaceState` en dix secondes et démontait alors la vue.
- Le runner local fournit aussi au pré-migrateur Firefox ses fixtures de clé et
  de sauvegarde jetables, exigées par le garde de migration avant le lancement
  du conteneur.
