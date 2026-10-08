# Tâches

- [x] T001 Analyser le HAR sans exposer secrets/contenu ; spécifier et analyser
  le périmètre avant code et vérifier les frontières de sync/sécurité.
- [x] T002 Compression sélective du helper Caddy, contrats et essai fonctionnel
  contenu synthétique gzip/identity/SSE ; config validée par le runtime installé.
- [x] T003 Appliquer ui-quality + lessons à la revue réelle, mesurer les octets
  et le rechargement, vérifier édition/mises à jour ; reload proxy 8082 seulement,
  garder API/DB/8080 et consigner preuves/limites avant convergence.

Preuves dans [validation.md](validation.md) : gzip niveau 1 final ; 41 tests de
contrat et Compose réussis ; 17 contrôles synthétiques réussis ; reload Caddy
isolé effectué ; transfert WASM réel réduit de 3 179 170 à 1 225 657 octets.
Rechargements navigateur sans cache HTTP et édition locale durable après
reload vérifiés ; fixture seule envoyée à la corbeille et 17 cartes restituées.
La convergence est établie dans ce périmètre. L'estimation HAR 36,84 → 12,08 Mo
décrit les octets éligibles, pas un temps d'ouverture mesuré ; les trois
rechargements par configuration sont trop bruités pour établir un gain de latence.
