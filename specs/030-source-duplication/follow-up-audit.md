# Analyse Slopo après refonte

## Résultat

| Mesure | Baseline | Après refonte |
| --- | ---: | ---: |
| Groupes | 173 | 109 |
| Unités participant aux groupes | 398 | 252 |
| Unités signalées comme copies exactes | 124 | 67 |

Les copies exactes comptent des unités partageant un corps, pas des paires.
Ces chiffres ne comptent pas les lignes supprimées. Les seuils, modèle, exclusions
et fichier ignore (vide) sont identiques à la baseline.

Qualification finale : {'idiom': 59, 'distinct': 50}. Aucun groupe initial « share » ne reste
avec sa même empreinte. Les huit groupes nouveaux/modifiés sont lus dans leur
contexte ; la règle de cellule commune découverte a été partagée via T067, puis
les différences d’orchestration restantes ont été conservées.

Les 101 groupes à empreinte inchangée gardent leur décision motivée initiale.
Les 109 décisions, chemins, tâches et références Spec Kit sont conservés dans
[follow-up-audit.json](follow-up-audit.json). L’empreinte seule ne prouve pas
la correction : elle complète la lecture des fonctions et leurs tests.

## Groupes nouveaux ou modifiés

| Groupe final | Empreinte | Décision | Contrat et justification | Tâche |
| --- | --- | --- | --- | --- |
| 30 | `325e6b96debe` | distinct | La règle valeurs/relations est désormais unique (T067). Le chemin hiérarchie garde trois retries sur stale-base, le contrôle du propriétaire, refresh et setProblem ; l’affichage intégré garde sa création implicite et ses propres erreurs. Ne pas fusionner ces orchestrations. | T022 |
| 47 | `25e4c9643530` | distinct | Création d’une nouvelle ambiguïté par clé logique/UUID/date courante versus restauration de son identité, état, octets et dates exacts. La restauration ne doit ni dédupliquer ni régénérer ces identités. | T045 |
| 60 | `f5ed9b23e92c` | distinct | Les métadonnées et digests sont partagés ; les wrappers conservent snapshot complet versus shallow-snapshot avec frontière de compaction explicite. | T038 |
| 61 | `f326e644748c` | distinct | Orchestration de publication des fichiers, protection des métadonnées et retraite des sources : phases, verrous, vérifications et effets différents. La vérification commune des métadonnées est déjà extraite. | T040 |
| 68 | `7d53b54f93d2` | idiom | Listes JSX de présentation avec classes et contenu propres au panneau. La règle de visibilité, accessibilité et titre désactivé est partagée dans PropertyVisibilitySwitch. | T043 |
| 71 | `5947b657ded4` | distinct | Petits adaptateurs password/passkey avec endpoints et corps distincts. L’adoption commune de session/CSRF est unique ; aucun intérêt à introduire une authentification générique à paramètres. | T039 |
| 89 | `97788bdccbc4` | idiom | Deux wrappers effacent le même index dérivé avant leur lecture V2/V3 propre. La persistance des usages trouvés est partagée ; ce petit préambule SQL conserve l’ordre effacement/lecture, y compris sur document V2 invalide. | T051 |
| 105 | `91ae73e71b6b` | distinct | Remplacement de valeurs versus résolution de conflit : disponibilité de l’appartenance/source, base courante versus parents revus, et préservation de l’enveloppe ne sont pas interchangeables. Validation de valeurs et commit partagés. | T049 |

## Conditions de reprise

Le rapport brut local est dans work/slopo/reports et la baseline figée dans
work/slopo/baseline-reports. Le fichier [slopo.conf.yaml](slopo.conf.yaml)
conserve les paramètres exacts pour une nouvelle analyse depuis la racine.
Slopo/Ollama restent de l’outillage local : aucune dépendance du produit ajoutée.
