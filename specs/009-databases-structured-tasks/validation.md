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
