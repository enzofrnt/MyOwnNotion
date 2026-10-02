# Réduction des duplications de logique

**Créé** : 2 octobre 2026 — **Statut** : implémentée et vérifiée localement ; E2E différés

## Contexte et périmètre

Qualifier les 173 groupes de ressemblances trouvés lors de l'analyse locale du
dépôt, puis supprimer les répétitions de logique qui apportent un bénéfice réel
de maintenance. Les contrats métier du produit doivent rester identiques. Les défauts de rendu
constatés pendant la revue des composants partagés peuvent être corrigés pour
respecter les exigences UI existantes, avec preuve visuelle. Le rapport
initial correspond au commit `e9eae014` ; tous les groupes sont identifiés par
leur empreinte et leurs emplacements, indépendamment de leur rang dans un rapport.

Références au canevas produit : sections 14 (bases), 18–20 (hors ligne,
synchronisation, conflits), 27–31 (portabilité, chiffrement, sauvegardes),
39 et 42 (livraison et tests), 46 (architecture évolutive). Aucune direction
produit ne change ; les spécifications des fonctions existantes restent valables.

## User Scenarios & Testing

### US1 — Comprendre tous les résultats (P1)

Le mainteneur dispose pour chacun des 173 groupes d'une décision argumentée :
logique à partager, ressemblance sans bénéfice de partage, ou contrats distincts
qui doivent rester séparés.

- Chaque groupe possède une empreinte, des emplacements et une justification.
- Les groupes retenus pointent vers une correction et sa vérification.
- Aucun groupe n'est écarté uniquement pour réduire le nombre de résultats.

### US2 — Maintenir une seule implémentation par contrat partagé (P1)

Le mainteneur fait évoluer une règle commune sans devoir corriger plusieurs
implémentations équivalentes. Les responsabilités différentes restent séparées.

- Les exportations, sauvegardes, requêtes et récupérations concernées produisent
  les mêmes résultats et erreurs qu'avant, y compris leurs cas limites.
- Les règles partagées restent utilisables hors ligne et respectent les
  frontières entre client, serveur et cœur métier.
- Les particularités des appelants, leurs droits et leur chiffrement sont
  conservés.

### US3 — Vérifier et reprendre le travail (P1)

Le mainteneur peut relancer l'analyse et comprendre les ressemblances restantes.

- Les corrections ont des tests ciblés et le contrôle de typage passe.
- Une nouvelle analyse confirme les extractions réalisées ; tout nouveau groupe
  provoqué par les refontes est également examiné.
- L'audit et les vérifications sont conservés dans les artefacts de feature.

## Requirements

- **FR-001** : Qualifier chacun des 173 groupes du rapport initial avec sa raison.
- **FR-002** : Corriger tous les groupes qualifiés de duplication utile à partager.
- **FR-003** : Conserver les résultats, erreurs, ordre, mutations et effets de bord
  de chaque contrat existant.
- **FR-004** : Conserver les garanties de données, droits, chiffrement et usage
  hors ligne ; aucun changement de stockage, migration ou protocole n'est prévu.
- **FR-005** : Exclure les abstractions fondées seulement sur de petits idiomes ou
  sur des responsabilités distinctes ayant un code proche.
- **FR-006** : Vérifier les corrections avec les contrôles pertinents et une
  nouvelle analyse intégrale.
- **FR-007** : Consigner les limites réelles de validation. Les E2E sont différés
  à la demande explicite du propriétaire ; aucun push n'est demandé dans ce travail.

## Edge Cases

Entrées malformées, documents anciens, valeurs nulles, tableaux vides, cycles,
ordre stable, résultats immuables, différences intentionnelles entre persistance
locale et serveur, erreurs fail closed, et groupes se chevauchant.

## Success Criteria

- **SC-001** : 173 décisions argumentées, sans groupe initial non qualifié.
- **SC-002** : Aucun groupe retenu ne conserve plusieurs implémentations du même
  contrat sans justification documentée.
- **SC-003** : Vérifications ciblées, typage et contrôles de format passent ;
  les limites de validation sont explicites.
- **SC-004** : Le rapport final et la table de qualification permettent de
  retrouver chaque décision et les corrections correspondantes.

## Liens aux exigences existantes

Voir [traceability.md](traceability.md) : correspondances par famille entre audit,
tâches, exigences des features existantes, extraction et tests. Les politiques
différentes identifiées lors de l’analyse y sont conservées explicitement.
