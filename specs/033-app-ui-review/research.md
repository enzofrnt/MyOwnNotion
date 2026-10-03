# Décisions

- **Décision** : poursuivre la bibliothèque `ui/primitives/`, déjà exportée.
  **Raison** : boutons/dialogues/menus sont déjà partagés ; une seconde lib
  créerait une nouvelle incohérence. Alternative rejetée : framework UI neuf.
- **Décision** : états conditionnels rendus avec leurs vrais composants sur
  services mémoire, comme le lab 031/032. **Raison** : observer les erreurs,
  conflits et récupérations sans altérer les données de dev. Alternative :
  déclencher de vrais incidents/suppressions, inutile pour une revue visuelle.
- **Décision** : conserver les tableaux spécialisés ; isoler leur scroll et
  partager seulement les rôles sans métier. Alternative : tableau universel
  absorbant modèles d’éditeur/base/conflit, complexité et régressions.
- **Décision** : mesure et capture du DOM réel, pas de certification E2E.
  Exception autorisée dans la conversation ; gate complet avant publication.
