# Data model

Aucun nouveau stockage. Une création de colonne fournit un dictionnaire de valeurs initiales : statut/sélection = option active ; sélection multiple = une option ; missing = vide. Même commande canonique de création d'entrée, source d'origine, identité/type/valeurs atomiques. Les filtres ne modifient pas ces valeurs.

État UI éphémère par colonne : idle → pending → succès (entrée ouverte) ou refusal → retry. Verrou global des créations pendant pending ; refus lié à la colonne. La géométrie d'en-tête et l'origine virtuelle sont locales, non synchronisées. La vue conserve ses paramètres existants.
