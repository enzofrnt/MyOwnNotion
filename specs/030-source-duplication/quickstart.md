# Vérifier la refonte

1. Lire audit.md, audit.json et traceability.md pour retrouver les contrats, tâches
   et exigences existantes. Consulter follow-up-audit.md pour le résultat final.
2. Consulter tasks.md pour les familles terminées et les vérifications.
3. Exécuter les suites Vitest touchées avec Bun et le runner PostgreSQL du dépôt.
4. Exécuter `bun run typecheck` et Biome sur les fichiers modifiés.
5. Relancer `sh work/slopo/run.sh` (installation locale existante ; Ollama actif).
6. Comparer le rapport à la baseline figée dans work/slopo/baseline-reports.

Ne pas lancer E2E pour ce travail : instruction utilisateur. Aucun push sans le
futur gate complet décrit dans docs/development.md. Les résultats effectifs sont
dans verification.md ; les étapes non réalisées ne sont jamais marquées passées.

Paramètres reproductibles : [slopo.conf.yaml](slopo.conf.yaml). Depuis la racine,
après création de work/slopo et installation locale de Slopo 0.9.0/Ollama :

```sh
slopo --config specs/030-source-duplication/slopo.conf.yaml index
slopo --config specs/030-source-duplication/slopo.conf.yaml embed
slopo --config specs/030-source-duplication/slopo.conf.yaml analyze
```
