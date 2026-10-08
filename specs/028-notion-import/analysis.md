# Pre-implementation analysis — 2026-10-04

10 requirements, four success criteria, three stories and eight constitutional
principles checked against plan and tasks. All mapped; no blocking ambiguity.
Owner's direct request supersedes file-based scope; canvas and roadmap aligned.
No Notion writes, background sync or new import UI authorized/required.
The follow-up repairs opening/editing through the existing editor.

Important risks assigned: multi-source head guards T033, complete property
pagination T028, media SSRF T032, protected offline resume T034, reports of
unsupported app semantics T030/T031/T036, isolation T026/T036. Reference brief
is source material; current official API and live responses govern details.
Historical evidence retained separately. No extension hooks configured.

Owner correction analysis: exclusions and hidden recovery archives refine
US2/FR-004–006 consistently with canvas 27.1. T039–T043 cover them, the discovered
databaseView activation prerequisite and UI-quality evidence. Recovery still
keeps encrypted originals; legacy plans remain immutable and resumable. Cleanup
must preserve IDs and owner edits. No new model, cover UI or people feature.

## Maintenance Matière — analyse de la correction

FR-004/006/007/009/010, le repli explicitement nommé et la conservation des
originaux gouvernent T049–T052. Le diagnostic réel confirme un axe multi-select
dans une vue board, refusé par evaluateDatabaseView ; BoardView ne sait pas non
plus le rendre. Les types admis par la conversion sont donc bornés au moteur
et au rendu existants. Aucune nouvelle capacité de base, aucun schéma, UI,
permission ou dépendance ajouté. La correction garde les propriétés visibles
actuelles, compare tous les autres réglages au snapshot et préserve les onglets
ajoutés. Tests d'évaluation native, backup puis CAS de présentation, readback
et revue UI isolée couvrent le changement. Pas de conflit avec le canevas §14,
la constitution ou 029/035.

La réparation aligne également la copie de compatibilité des vues sur leur
présentation actuelle, par commande canonique sous révision vérifiée ; une
édition ultérieure de propriété ne restaure plus la configuration importée
invalide. Le schéma de propriétés et les présentations restent identiques.

## Révision native 036

Le propriétaire a refusé le fallback Matière. La cohérence actuelle suit [036](../036-multi-select-boards/spec.md) : regroupement multi-select natif, import sans repli pour ce cas, restauration gardée de présentation et copie de vues. L’analyse de maintenance antérieure reste historique.
