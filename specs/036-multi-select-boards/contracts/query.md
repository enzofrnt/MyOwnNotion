# Query and movement contract

rows : identités uniques, valeurs visibles plus axe board requis. groups : IDs/labels/counts par appartenance ; counts disponibles seulement selon couverture complète existante. groupId : unique groupe ou null pour plusieurs, aucune sélection arbitraire. API et local utilisent la même projection.

move(property, destination, row, sourceColumn) : source connue, destination active ; même colonne→null ; multi A+B→C = B+C ; A+B→B = B ; missing→C = C ; vers missing = clear ; autre type canonique conservé. Préserver les valeurs historiques : refuser une écriture incompatible plutôt que les effacer. Résoudre l’intention sur les valeurs complètes relues, pas le DTO affiché. Aucun changement de protocole.
