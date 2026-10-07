# Validation guide

1. Bun 1.4.2, PostgreSQL test existant, aucune donnée propriétaire effacée.
2. Tests unitaires ciblés web/client-core pour boot, callback, couverture,
   garde outbox, navigation et recherche.
3. E2E fixture ≥300 descendants, profil vierge, lot retenu 5 s ; vérifier racines,
   expansion/loading, URL descendant et reprise, puis égalité finale.
4. Profil rempli : réseau retenu, navigation/page disponibles ; édition/reconnexion.
5. Revue réelle clair/sombre, clavier, 320 px ; captures privées work/notion-api.
6. Gate complet docs/development.md, équivalents Linux sur macOS ; documenter
   toute limite, aucune tâche complète sur seule preuve jsdom.
