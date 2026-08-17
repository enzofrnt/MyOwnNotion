# Fichiers : ce qui est garanti et pourquoi

Trois règles gouvernent le traitement des fichiers. Chacune existe parce que
l'implémentation évidente coûte quelque chose à l'utilisateur.

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

## 2. L'éditeur de diagrammes est servi par cette installation

L'intégration Draw.io évidente est une iframe vers `embed.diagrams.net`. Elle
fonctionne parfaitement — et **envoie le diagramme du propriétaire à un tiers à
chaque édition**. Un schéma de sa propre infrastructure est exactement ce qu'un
propriétaire ne publierait jamais sciemment sur un service public, et le produit
est auto-hébergé précisément pour qu'il n'ait pas à le faire.

L'éditeur tourne donc dans la pile Compose de l'installation, avec une image
épinglée comme les autres.

`assertLocalEditor` refuse `diagrams.net`, `draw.io` et `jgraph.com` au lieu de
faire confiance à la configuration. C'est la seule mauvaise configuration qui ne
dégrade rien : elle exfiltre. Elle échoue donc bruyamment, nomme l'hôte fautif,
et refuse aussi une origine malformée — « impossible à vérifier » ne doit pas se
résoudre en « autorisé » quand ce qu'on vérifie est une fuite de données.

La comparaison porte sur les hôtes et les suffixes, jamais sur des
sous-chaînes : `sneaky.diagrams.net` est refusé, et le
`diagrams.net.internal.example.org` de quelqu'un ne l'est pas.

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

**Un upload partiel n'est pas un blob.** Un blob est adressé par l'empreinte de
son contenu, et un transfert inachevé n'a pas encore d'empreinte — c'est
précisément ce qui le rend partiel. Le forcer dans le magasin de blobs
demanderait soit d'inventer une clé qui n'est pas une empreinte, brisant l'unique
invariant de ce magasin, soit de hacher à chaque morceau, ce qui pour un fichier
de 2 Go signifie hacher 2 Go des centaines de fois. Les transferts en cours ont
donc leur propre magasin, indexé par identité d'upload, et ne deviennent un blob
qu'une fois complets — hachés une seule fois.

**L'ordre d'écriture est celui qui pardonne.** L'offset est enregistré en base
*avant* que les octets soient ajoutés au fichier. Si l'enregistrement avance et
que l'ajout échoue, le client se voit annoncer une position que le fichier n'a
pas atteinte, et le `HEAD` suivant révèle l'écart. Dans l'autre ordre, le fichier
contiendrait silencieusement un morceau dont rien ne rend compte.

La complétion est transactionnelle : hachage, déduplication, `verified_at`,
fichier logique, placement, enregistrement de mutation et enveloppe de
changement. Le fichier partiel n'est effacé qu'**après** la validation — l'effacer
avant laisserait, sur un échec, un upload marqué complet dont les octets ont
disparu.

## Limite connue : recharger hors ligne

Le contenu marqué s'ouvre sans réseau **dans une session déjà chargée**.
Recharger l'application hors ligne échoue, car la coquille elle-même n'est pas
mise en cache : cela demanderait un service worker, hors du périmètre de la
fonctionnalité 005. `validation.md` le consigne comme un manque plutôt que
comme une exigence satisfaite.
