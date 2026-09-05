# Validation desktop — reprise du 5 septembre 2026

Branche : `codex/014-desktop-completion`.
Source préservée : commit local `7dc9d030` et les 150 chemins modifiés/non suivis
copiés depuis `/Users/enzofournet/Git/MyOwnNotion`. Le checkout source n'a pas été
réinitialisé ni modifié par cette reprise.

Runtime : Bun 1.4.0 ; hôte Electron 44.1.1 ; production construite par Bun.

## Preuves acquises

- Compilation des workspaces et TypeScript racine réussie.
- Package macOS ARM64 construit et exécutable packagé lancé avec un profil
  temporaire : `app.isPackaged`, architecture, sandbox, isolation du contexte,
  absence de `require` dans le rendu et focus clavier vérifiés.
- Neuf parcours Electron implémentés ; sept parcours initiaux passés sur macOS ARM64 : profil/connexion/redémarrage,
  création hors ligne puis arrêt brutal et réconciliation, révocation effective
  avec comparaison du contenu chiffré de l'outbox, fichiers natifs, refus des
  liens dangereux, erreurs de connexion et état explicite des mises à jour non
  configurées. Les ajouts sauvegarde native et ouverture du navigateur système
  ont également passé. Le parcours signé réel vérifie l'écran de report,
  téléchargement corrompu refusé et nouvelle tentative réussie avant handoff.
  Les deux scans axe onboarding/workspace/sécurité et le démarrage hors ligne
  avec édition de texte ont passé lors des contrôles ciblés suivants.
- Tests de coffre : chiffrement OS asynchrone, refus Linux sans backend protégé,
  profils isolés, absence de remplacement implicite d'une clé, reprise d'une
  enveloppe historique exacte, refus d'un format futur/corrompu sans écrasement.
- Tests de mise à jour : signatures Ed25519 réelles, mauvaise clé/signature,
  téléchargement corrompu refusé, nouvelle mutation pendant téléchargement,
  reprise après erreur, refus de downgrade et de protocole incompatible.
- 65 tests ciblés d'authentification passés, dont assertions WebAuthn P-256
  réellement signées : origines configurées, mauvaise origine/challenge,
  absence de vérification utilisateur, compteur régressant et signature altérée.
  Les routes privées refusent les lectures anonymes et les appareils révoqués ;
  les mutations exigent le CSRF de la session.

## Vérifications en cours et limites de preuve

Le passage local sur `b80cf514` a validé 372 fichiers / 3551 tests et le seuil
agrégé de couverture, les huit benchmarks, les migrations et 1290 tests de
contrat. La matrice navigateur a révélé des appels de préparation de tests sans
session et l'absence de CSRF sur le transfert de fichiers par morceaux ; ce
passage a été arrêté en échec, sans push. Les corrections suivantes ont validé
19 parcours ciblés de contenu/transfert, puis les deux parcours de compatibilité
et révocation. Les 58 contrats d'authentification passent avec le diagnostic sûr
`device_revoked` pour un détenteur de session valide, sans accès au contenu.

L'écran de connexion a été contrôlé dans le package macOS réel après correction
des styles actifs. Les tests vérifient la reprise après rejet IPC, la conservation
de la saisie, le CSRF courant sur chaque chunk et le refus d'une destination
externe. L'AppImage vérifiée devient exécutable par son propriétaire avant le
handoff ; neuf tests de récupération de mise à jour passent.

Le scan Trivy 0.70.0 de l'image API linux/amd64 a passé (HIGH/CRITICAL avec
correctif : zéro). La chaîne locale complète doit être relancée sur le commit
final : elle inclut les cinq navigateurs, le package, le smoke installé et les
parcours Electron. Le passage local complet, la CI de PR et la CI du commit
fusionné sur main ne sont pas encore attestés.

La matrice CI configure les cinq cibles natives avec PostgreSQL 18 ; elle doit
encore être exécutée. Windows ARM utilise un PostgreSQL x64 de test sous
émulation, sans ajouter ce serveur au package ARM64.

Les neuf installateurs signés/notarisés n'ont pas été produits. Aucun certificat
de distribution ni secret de publication n'est configuré dans GitHub lors de
cette reprise. Le workflow vérifie les signatures natives, l'architecture et les
empreintes avant de signer les manifests. L'existence de ce code ne prouve pas
une exécution de release. Le test N→N+1 signé, les démarrages invalides après
installation et la mesure 19/20 installations par cible restent à réaliser.

La mise à jour actuelle remet l'installateur vérifié au système, puis demande
au propriétaire de terminer l'installation et de redémarrer. Elle ne remplace
pas automatiquement le binaire et n'annonce pas un faux succès d'installation.
Le coffre utilise les migrations transactionnelles Dexie du cœur client ; le
format natif initial n'a pas de migration de contenu. Aucun checkpoint fictif
ne constitue une preuve de restauration.

La couverture d'accessibilité desktop et la parité exhaustive de tous les
parcours Web doivent être distinguées des sept parcours ciblés. Les critères
SC-001, SC-002, SC-006, SC-007 et SC-008 ne sont pas déclarés intégralement
validés à ce stade. Aucun merge ou publication n'est attesté dans ce document.
