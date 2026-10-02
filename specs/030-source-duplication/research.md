# Recherche et décisions

Le rapport figé contient 173 groupes sur 651 fichiers et 6139 unités de code.
Les 124 unités à corps exact ne représentent pas 124 paires indépendantes.
Audit intégral réparti en quatre lectures de sources : 1–43, 44–86, 87–129, 130–173.
Les résultats sont réunis dans audit.json avec empreintes, chemins, raisons et
extractions proposées. Les groupes distincts sont vérifiés contre leur contrat,
notamment tri des relations, tables vides, causalité, retry et ownership.

Décision : pureté et proximité des responsabilités priment sur le score Slopo.
Alternative rejetée : factoriser toutes les ressemblances, qui créerait des
paramètres sans contrat ou mélangerait client/serveur. Alternative rejetée :
ignorer les groupes pour baisser le compteur sans les analyser.

JSON déterministe général et JSON des documents ont des règles différentes ;
ne pas les fusionner. Les snippets ont des normalisations locales différentes ;
le texte comparable doit être fourni. Les renderers Markdown V2/V3 gardent leurs
politiques de marks. Les différences d’erreurs, snapshots, chiffrement et CAS
restent explicites dans l’audit et les tests.

## Liens aux exigences existantes

Voir [traceability.md](traceability.md) : correspondances par famille entre audit,
tâches, exigences des features existantes, extraction et tests. Les politiques
différentes identifiées lors de l’analyse y sont conservées explicitement.

## Rendu réel et conservation des contrats

La revue des composants React réellement chargés par Vite a montré un nom
d’utilisation de fichier trop long pour 320 px. T068 remet le retour à la ligne
dans le composant partagé, conformément à 003 FR-021 et ui-quality/L-010. La
feuille attachment-usages.css est chargée depuis le global.css actif. Les
observations clavier et captures sont référencées dans verification.md.
