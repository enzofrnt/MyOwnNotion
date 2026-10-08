# Data model

Aucune migration. Entrées/pages, sources, valeurs et présentation des vues
restent canoniques et synchronisées. La carte transitoire garde titre, type,
valeurs, relations, champs changés, attente et erreurs. La création persiste
atomiquement sur Entrée ou clic extérieur ; vide non persisté. L'édition
existante sérialise les changements et avance sa baseline après chaque succès.
Les refus gardent les derniers brouillons et une reprise locale. Le regroupement
est enregistré immédiatement ; l'occurrence éditée reste montée dans sa colonne
jusqu'à fermeture, puis rejoint sa destination. Les propriétés masquées viennent
de l'entrée de même révision, sans changer leur visibilité. Conversion réutilise
les conséquences/confirmations canoniques. Volet transitoire : identité, retour
focus, sortie ; même entrée/document/propriétés, aucun duplicat de contenu.
