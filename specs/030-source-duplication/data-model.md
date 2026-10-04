# Modèle de données

Aucun changement des entités persistées, des schémas ou migrations.

## Groupe de qualification (artefact de développement)

`number` : rang initial 1–173 ; `hash` : empreinte Slopo ; `paths` : sources.
`decision` : share / idiom / distinct ; `rationale` : contrat et raison.
`proposedExtraction` : précautions/extraction candidate lorsque fournie.
`relatedSpecs` : chemins des specs existantes et identifiants FR liés au contrat.
Pour les décisions `share` : `family`, `task`, `extraction`, `verificationTests`
et `implementationStatus` relient regroupement, correction et vérification.
Les chemins de tests ne constituent pas seuls une preuve d’exécution : consulter
verification.md pour les résultats effectifs et limites.

Les groupes se recouvrent : une famille peut satisfaire plusieurs décisions.
Les nouveaux résultats sont comparés par empreinte et chemin, jamais par rang seul.

## Invariants des extractions

Les DTO, documents et valeurs restent identiques ; les copies défensives restent
indépendantes. Les transactions, parents de révision, ordre des écritures et
garanties d’accès/chiffrement gardent leur contrat actuel.

## Qualification finale

follow-up-audit.json garde les empreintes et chemins actuels, la décision motivée,
les références Spec Kit, le groupe initial quand inchangé et la tâche reliée quand
nouveau/modifié. La disparition d’une empreinte complète les contrôles de code
et les tests ; elle ne prouve pas seule la correction.
