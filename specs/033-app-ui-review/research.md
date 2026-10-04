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
- **Décision** : garder mesures/captures du DOM réel et parcours automatisés
  comme preuves complémentaires. Le propriétaire lève le report des E2E le
  2026-10-03 : toutes les suites sont remises en cohérence, le contrôle local
  complet doit passer sur chaque commit poussé, puis la CI de la PR doit être
  verte. Les fixtures de test restent isolées de l'instance et des données de dev.
