# Research

## Native grouping

Decision : membership par option, aucune duplication canonique. Rationale : une propriété multi-select contient un ensemble et un Kanban expose ces options. [Documentation primaire Notion](https://www.notion.com/help/boards) consultée le 2026-10-04 : axes multi-select et déplacement de cartes pris en charge. La documentation ne spécifie pas précisément les autres tags au déplacement ; règle native explicite FR-005 choisie pour éviter la perte de valeurs. Alternative écartée : table fallback, refusée explicitement par le propriétaire.

## Contract and storage

Decision : valeurs typées d'axe conservées dans la projection même masqué ; DTO scalaire existant non étendu. Rationale : renderer dérive les memberships et garde les autres valeurs lors d'un mouvement ; groupes donnent les counts filtrés, pagination par entrée unique. Alternative écartée : dupliquer des rows ou choisir arbitrairement un seul groupId. Aucune migration, aucune conversion des propriétés.

## Restoration

Decision : comparer aux deux réparations historiques puis synchroniser presentation et definition.views ; sauvegarde vérifiée, CAS et readback. Rationale : une édition future de propriété ne doit pas restaurer le mauvais format. Alternative écartée : réimport/reset du workspace ou écrasement global des vues.

## Audits délégués

Deux audits en lecture seule confirment stockage existant, pagination unique, nécessité de l’axe masqué, cohérence group/axis et origine des déplacements. Choix retenu : conserver le DTO et inclure la valeur d’axe requise (visibilité UI, pas contrôle d’accès), résoudre l’intention sur la relecture complète ; pas de divulgation des IDs du corpus dans les groupes. Axe effectif board dérivé de options.axisPropertyId même avec group:null historique. Valeurs retirées incompatibles refusées sans suppression. Focus restitué à l’occurrence source à la fermeture et à la cible après déplacement clavier.
