# Fichiers : ce qui est garanti et pourquoi

Les règles suivantes couvrent les prévisualisations, la disponibilité locale et
la durabilité du stockage serveur.

## 1. Une prévisualisation ne reçoit jamais l'espace de travail

Un fichier est une suite d'octets que le propriétaire a obtenue ailleurs, et
deux des formats que le produit s'engage à prévisualiser — SVG et PDF — peuvent
porter du script. Rendu en ligne depuis l'origine de l'application, ce script
s'exécute avec les privilèges de l'application, contre tout ce que le
propriétaire a écrit.

La question n'est donc jamais de savoir si un fichier particulier est hostile,
mais ce qu'il pourrait faire s'il l'était.

**Deux couches, parce que chacune seule a une forme de contournement connue.**

Le serveur sert le contenu avec `Content-Disposition: attachment`,
`X-Content-Type-Options: nosniff` et une politique qui refuse toute capacité à
la réponse. Le client rend **toute** prévisualisation — y compris les formats
d'apparence inoffensive — dans un unique cadre en bac à sable alimenté par une
URL de blob.

Cette uniformité est le choix de conception : dès que la prévisualisation se
décide par format, quelqu'un ajoute un format et oublie laquelle des deux
branches était la branche sûre.

Le cadre porte `allow-scripts` et **délibérément pas** `allow-same-origin`. Ce
jeton unique fait toute la différence : avec lui, le bac à sable est décoratif,
puisque le script s'exécute comme cette origine et peut lire la session, l'API
et l'espace de travail. Sans lui, le cadre est une origine opaque, et les
scripts dont un lecteur PDF a besoin deviennent inoffensifs.

Le parcours l'affirme par la négative : un SVG qui tente de lire
`window.parent.document` et d'exfiltrer ce qu'il trouve est téléversé,
prévisualisé, et rien n'arrive.

## 2. L'édition de diagrammes n'ajoute aucun service à la stack

Un fichier `.drawio` est actuellement une pièce jointe opaque : MyOwnNotion le
stocke, le synchronise et permet de le télécharger, mais ne prétend ni le
prévisualiser ni l'éditer.

Les deux raccourcis ont été refusés. Une iframe vers `embed.diagrams.net`
enverrait le diagramme du propriétaire à un tiers et cesserait de fonctionner
hors ligne. Un conteneur Draw.io auto-hébergé éviterait cette fuite, mais
ajouterait une seconde application, un port, un cycle de mise à jour et une
surface de panne à la stack essentielle alors que cette capacité est différée.

La stack ne contient donc aucun serveur Draw.io et l'application n'accepte pas
Draw.io comme fournisseur d'embed. Si l'édition de diagrammes est spécifiée
après les fondations d'édition et de synchronisation, son moteur s'exécutera
directement dans MyOwnNotion et utilisera les mêmes chemins de durabilité,
synchronisation, historique et sauvegarde que les autres contenus.

## 3. C'est la récupérabilité qui admet un contenu à l'éviction

Quand un appareil atteint sa limite, il libère du contenu. Ce qui décide n'est
ni la taille ni l'âge, mais **le serveur peut-il le rendre**. La taille et l'âge
n'ordonnent que ce qui est déjà admis.

Formulé dans l'autre sens — « évincer le plus gros » ou « le plus ancien » —
c'est exactement ainsi qu'un changement non synchronisé se fait libérer, car un
tel changement est souvent les deux à la fois. Les deux groupes protégés sont
donc filtrés **avant** tout tri : aucune erreur d'ordonnancement ne peut les
atteindre.

Ne sont jamais libérés :

1. le travail que le serveur n'a pas — changements non envoyés, conflits non
   résolus — et ce qui est nécessaire pour accéder à l'espace de travail ;
2. tout ce que le propriétaire a marqué pour rester disponible hors ligne.

Un déchargement conserve la ligne, le titre et les métadonnées, et ne retire que
le contenu. Retirer la ligne ressemblerait, pour le propriétaire, exactement à
une suppression.

**Trois états de disponibilité, pas deux.** « Déchargé » signifie que cet
appareil l'a eu et l'a relâché ; « jamais récupéré » signifie qu'il ne l'a
jamais ouvert ici. Fusionnés en « pas ici », ils se lisent pareil et ne veulent
pas dire la même chose. Aucun des trois ne se lit **manquant** : un contenu que
le serveur détient n'est pas perdu parce que cet ordinateur ne l'a pas récupéré.

## 4. L'offset du serveur est le seul offset

Pour les transferts reprenables (tus 1.0), un `PATCH` dont l'offset est en
désaccord avec le serveur est refusé avec un 409 et se voit dire où reprendre.
Il n'est jamais accepté à la position du serveur : cette correction silencieuse
écrit les octets du client au mauvais endroit, et le fichier se termine puis se
vérifie comme si de rien n'était. C'est le seul mode de défaillance ici qui ne
s'annonce pas.

L'avancement est conditionnel en SQL plutôt que lu-puis-écrit, afin que deux
reprises d'un même morceau ne puissent pas toutes deux prétendre l'étendre.

Un transfert en cours ne possède ni item ni placement. « Un transfert partiel
n'apparaît jamais comme un fichier complet » est donc une propriété de la forme
des données, pas un contrôle qu'il faut penser à écrire.

Les octets complets et les préfixes tus sont chiffrés par morceaux authentifiés
de 4 Mio. Leur manifeste lie chaque morceau à une identité de contenu ou
d'upload, une version, un index, une taille et une génération de clé. Une lecture
partielle authentifie les morceaux traversés ; une lecture complète vérifie
aussi la taille et l'empreinte finales. Aucun repli vers des octets lisibles
n'est admis lorsque le format annonce du contenu protégé.

Le serveur publie et synchronise les fichiers chiffrés **avant** de valider en
SQL le manifeste et l'offset. Un échec laisse donc l'ancien offset utilisable ;
un éventuel morceau non référencé peut être collecté plus tard. Le verrou de
l'upload et la comparaison de l'offset empêchent deux `PATCH` concurrents de
s'approprier la même position. L'empreinte publique du texte clair n'est pas
une clé de stockage : la recherche de doublons utilise un index secret, puis
compare réellement les octets authentifiés avant réutilisation.

La complétion publie transactionnellement le contenu, le fichier logique, son
placement et le résultat de mutation. Un reçu permet de rejouer une complétion
dont la réponse a été perdue sans créer un second fichier. La collecte physique
ne retire que des objets sans référence durable. Les lectures, les sauvegardes,
les rotations et cette collecte partagent les mêmes verrous de maintenance.

## 5. La migration conserve une reprise vérifiable

La mise à jour crée une sauvegarde complète avant ses premières modifications.
Elle inventorie les anciens contenus, les préfixes acquittés, les octets
orphelins et les métadonnées canoniques courantes/historiques. L'inventaire et
chaque point de reprise sont eux-mêmes chiffrés et liés à cette sauvegarde.
Les contenus partagés conservent leur UUID et leurs références ; les uploads
conservent leur identité, leur position, leurs métadonnées et leur expiration.
Les orphelins, y compris les queues non acquittées, sont conservés en quarantaine
chiffrée avec un manifeste protégé.

Chaque remplacement est authentifié et comparé à sa source. Les champs SQL
sensibles deviennent des marqueurs et leurs lectures passent par les enveloppes
protégées. La vérification globale précède la bascule ; la suppression de chaque
original revalide son remplacement et synchronise le répertoire avant le point
de reprise SQL. Un original déjà supprimé après une interruption reste une
situation reprenable. Une transition incomplète bloque le démarrage et les
mutations incompatibles. La version de l'application n'est enregistrée comme
réussie qu'après la fin de cette transition et le contrôle canonique.

Voir [le guide de sauvegarde](../deployment/backups.md) pour l'espace disque,
la reprise et la restauration complète. Cette protection concerne le contenu
logique courant et les fichiers applicatifs ; elle ne prétend pas effacer
rétroactivement des WAL, pages PostgreSQL mortes ou snapshots externes.

## Disponibilité après fermeture ou rechargement

Le build web de production enregistre un service worker qui précache sa coque.
Les réponses API restent hors de ce cache : les données disponibles sont celles
de la projection locale. Le desktop utilise les assets de son paquet et le même
modèle de disponibilité des contenus, sans enregistrer ce service worker.
Un fichier déchargé ou jamais récupéré nécessite toujours une connexion pour
obtenir ses octets ; la présence de la coque ne signifie pas que tous les
fichiers sont conservés localement.
