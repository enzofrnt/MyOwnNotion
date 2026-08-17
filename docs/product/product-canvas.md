# Spécification produit maître — MyOwnNotion

**Statut** : canevas maître complet, consolidé et prêt pour validation
**Produit** : application personnelle mono-utilisateur et auto-hébergée
**Propriétaire fonctionnel** : le propriétaire unique de l'installation
**Déploiement officiel** : Docker Compose, application exposée localement en HTTP derrière un reverse proxy externe
**Inspirations principales** : Notion et Obsidian
**Priorités absolues** : intégrité des données, fonctionnement hors ligne, synchronisation, chiffrement, sauvegarde, récupération et contrôle par le propriétaire
**Langue de référence de cette spécification** : français

---

## Navigation du document

- **Cadre produit** : sections 1 à 7
- **Identité et contenus** : sections 8 à 16
- **Local-first et fonctions avancées** : sections 17 à 27
- **Protection et exploitation des données** : sections 28 à 35
- **Déploiement et chaîne de livraison** : sections 36 à 42
- **Qualité, documentation et trajectoire** : sections 43 à 50

---

## 1. Objet et règles d'interprétation

Ce document est la source maîtresse des exigences produit et des exigences transversales de MyOwnNotion. Il décrit :

- la cible fonctionnelle complète ;
- le périmètre obligatoire de la V1 ;
- les versions ultérieures envisagées ;
- les contraintes de sécurité, de données et d'exploitation ;
- les règles de développement, de test, de livraison et de publication.

Les termes normatifs sont interprétés ainsi :

- **doit** : exigence obligatoire ;
- **ne doit pas** : interdiction ;
- **devrait** : exigence normalement obligatoire, sauf justification documentée ;
- **peut** : capacité facultative.

Une exigence n'est considérée comme satisfaite que si elle possède un moyen de vérification reproductible : test automatisé, scénario d'acceptation, contrôle de sécurité, inspection d'un artefact ou procédure documentée.

Les spécifications de fonctionnalité détaillées peuvent préciser ce document, mais ne peuvent pas contredire ses invariants. Les décisions techniques réversibles appartiennent aux plans d'implémentation.

---

## 2. Décisions structurantes validées

1. MyOwnNotion possède exactement un propriétaire et aucun autre compte applicatif.
2. Le document maître distingue la cible complète, la V1 et les versions suivantes.
3. La V1 est un produit utilisable comprenant le Web responsive, Compose, l'authentification, les pages et dossiers, l'éditeur, les fichiers, la recherche, le hors-ligne, la synchronisation, la sauvegarde/restauration et l'export.
4. Les données sont chiffrées par l'application au repos sur le serveur.
5. La clé protégeant les données du serveur est externe aux données et fournie comme secret au déploiement.
6. Les volumes d'hébergement doivent pouvoir bénéficier d'un second niveau de protection lorsque la plateforme le permet.
7. Les données conservées localement par chaque appareil sont également chiffrées.
8. Un kit de récupération chiffré et conservable hors ligne est obligatoire.
9. L'application fonctionne en HTTP sur le réseau local ; un reverse proxy externe assure HTTPS et la publication sur Internet.
10. Le dépôt ne fournit ni certificat public ni reverse proxy obligatoire dans la stack applicative officielle.

---

## 3. Vision produit

MyOwnNotion est une application personnelle et auto-hébergée destinée à centraliser les notes, pages, dossiers, tâches, bases de données, fichiers et connaissances de son propriétaire unique.

Elle doit proposer à terme :

- une organisation et une édition proches de Notion ;
- une navigation latérale inspirée de Notion et d'Obsidian ;
- un graphe avancé et filtrable ;
- des tableaux blancs ;
- des pièces jointes et fichiers autonomes ;
- un fonctionnement hors ligne ;
- une synchronisation rapide entre les appareils ;
- des sauvegardes chiffrées, vérifiées et restaurables ;
- des mises à jour avec retour arrière ;
- le partage public de pages ou dossiers ;
- des annotations publiques ;
- un serveur MCP sécurisé.

L'application n'est pas destinée à devenir une plateforme SaaS, un espace de travail d'équipe ou un produit multi-utilisateur.

---

## 4. Principes non négociables

### 4.1 Propriété des données

- Le propriétaire doit pouvoir exporter l'intégralité de ses données dans un format durable et documenté.
- Aucune fonction essentielle ne doit dépendre d'un service propriétaire impossible à remplacer.
- Les données ne doivent pas être utilisées pour de la publicité, de l'entraînement ou de la télémétrie non consentie.

### 4.2 Absence de perte silencieuse

- Une donnée locale non synchronisée ne doit jamais être supprimée automatiquement.
- Un conflit, une erreur de migration ou une erreur de restauration ne doit jamais écraser silencieusement une version existante.
- Toute opération destructive importante doit être confirmée, traçable et, lorsque possible, réversible.

### 4.3 Local-first

- Les opérations courantes doivent rester rapides et disponibles lorsque les données nécessaires sont présentes sur l'appareil.
- La perte temporaire du réseau ne doit pas interrompre l'édition des contenus disponibles localement.
- Le serveur reste la source de synchronisation et de sauvegarde, mais le client ne doit pas dépendre d'un aller-retour réseau pour chaque interaction.

### 4.4 Sécurité par défaut

- Les secrets ne doivent jamais être stockés dans Git, intégrés aux images ou écrits dans les journaux.
- L'installation par défaut ne doit pas exposer directement un service sensible à Internet.
- Les permissions doivent suivre le principe du moindre privilège.

---

## 5. Acteurs et limites du mono-utilisateur

### 5.1 Propriétaire

MyOwnNotion possède exactement un utilisateur : son propriétaire. Il s'agit de l'unique utilisateur authentifié de l'application et il peut utiliser plusieurs appareils autorisés avec la même identité.

Il n'existe pas :

- de création de comptes supplémentaires ;
- de rôles d'équipe ;
- de membres ;
- d'invités privés ;
- d'organisation multi-utilisateur ;
- de coédition privée entre plusieurs identités.

### 5.2 Visiteur public

Un visiteur public :

- accède uniquement à une ressource explicitement partagée ;
- ne possède pas de compte ;
- ne devient jamais utilisateur de l'installation ;
- peut annoter uniquement si cette permission est activée ;
- ne peut découvrir aucune ressource privée par navigation, recherche ou API.

### 5.3 Client MCP

Un client MCP est une intégration autorisée par le propriétaire. Il ne constitue pas un second utilisateur et n'obtient que les permissions explicitement accordées.

### 5.4 Administrateur de l'hébergement

L'administrateur de l'hébergement peut exploiter Compose, gérer les secrets, lancer les sauvegardes et exécuter les commandes de récupération. Dans le cas normal, il s'agit du propriétaire lui-même.

---

## 6. Périmètre par version

### 6.1 V1 obligatoire

La V1 doit fournir un parcours complet et exploitable comprenant :

- déploiement du serveur avec Compose ;
- client Web responsive ;
- authentification mono-utilisateur par passkey et mot de passe ;
- gestion des appareils et sessions ;
- pages, dossiers et hiérarchie ;
- navigation latérale ;
- éditeur par blocs ;
- fichiers et pièces jointes ;
- prévisualisation des formats obligatoires ;
- recherche dans les contenus pris en charge ;
- stockage local chiffré ;
- fonctionnement hors ligne ;
- synchronisation multi-appareils ;
- détection et résolution sûre des conflits ;
- sauvegarde chiffrée, vérification et restauration ;
- export complet et documenté ;
- mise à jour avec sauvegarde préalable et retour arrière ;
- commandes administratives essentielles ;
- observabilité locale et diagnostics expurgés ;
- chaîne de développement, CI, images conteneurisées et publication GitHub.

La V1 n'est livrable que si chacun de ces domaines possède des scénarios d'acceptation et des tests adaptés.

### 6.2 Après la V1

Les capacités suivantes appartiennent à la cible complète, mais peuvent être livrées après la V1 :

- bases de données avancées et toutes leurs vues ;
- tâches structurées avancées ;
- graphe de connaissances complet ;
- tableaux blancs ;
- partage public et annotations publiques ;
- serveur MCP ;
- applications Electron Windows et macOS ;
- adaptation iOS avancée ou application iOS native.

Les fondations de la V1 ne doivent pas rendre ces ajouts difficiles ou nécessiter une rupture du modèle de données canonique.

---

## 7. Plateformes et compatibilité

Le produit doit être progressivement disponible sous forme de :

1. site Web responsive connecté au serveur auto-hébergé ;
2. application Electron pour Windows ;
3. application Electron pour macOS ;
4. Web app installable et adaptée à iOS ;
5. application iOS native si la Web app ne peut pas satisfaire les exigences de sécurité, de stockage local ou d'expérience attendues.

Chaque client se connecte au serveur en renseignant son URL. Il vérifie :

- l'accessibilité du serveur ;
- la compatibilité de version du protocole ;
- la sécurité du canal lorsqu'il utilise une URL HTTPS ;
- l'authentification du propriétaire ;
- l'état de la synchronisation.

L'accès HTTP doit être accepté uniquement pour les adresses locales ou les environnements explicitement déclarés comme sûrs. L'interface doit avertir clairement si une URL HTTP non locale est utilisée.

Le client Web V1 doit prendre en charge les deux dernières versions majeures stables de Chrome, Edge, Firefox et Safari. L'interface doit rester utilisable à partir d'une largeur de 320 pixels.

---

## 8. Authentification et sessions

Le propriétaire peut se connecter avec :

- une passkey suffisante à elle seule ;
- un mot de passe comme méthode alternative.

Le système doit permettre :

- l'enregistrement initial sécurisé du propriétaire ;
- l'ajout et la suppression de passkeys ;
- la modification du mot de passe ;
- la révocation d'une session ou de toutes les sessions ;
- la protection renforcée des opérations sensibles ;
- la récupération administrative de l'accès ;
- la détection et la limitation des tentatives d'authentification abusives.

Une session propriétaire expire après 30 jours d'inactivité par défaut. Cette durée est configurable entre 1 et 90 jours. Une opération sensible exige par défaut une authentification datant de moins de 15 minutes.

Les mots de passe doivent être traités avec un algorithme de dérivation résistant et paramétrable. Les sessions Web doivent utiliser des cookies sécurisés, non accessibles au JavaScript et protégés contre les requêtes intersites. Aucune session ne doit être placée dans une URL.

Les opérations suivantes exigent une authentification récente :

- modification des méthodes d'authentification ;
- génération ou remplacement du kit de récupération ;
- rotation des clés ;
- révocation globale des appareils ;
- restauration destructive ;
- création d'un accès MCP puissant.

---

## 9. Appareils autorisés

Une page de réglages affiche les appareils connectés. Pour chaque appareil, elle indique :

- son nom ;
- sa plateforme ;
- son type de client ;
- sa date d'autorisation ;
- sa dernière activité ;
- sa dernière synchronisation ;
- son état ;
- sa limite de stockage local ;
- son usage local actuel.

Le propriétaire peut :

- renommer un appareil ;
- modifier sa limite de stockage depuis l'appareil concerné ;
- consulter son état ;
- révoquer son accès.

Un appareil révoqué ne peut plus se connecter, renouveler sa session ni recevoir de nouvelles données sans une nouvelle autorisation. La révocation doit aussi empêcher l'utilisation future de ses clés de synchronisation.

Les données déjà présentes sur un appareil perdu ne peuvent pas être garanties comme effacées à distance si celui-ci ne se reconnecte jamais. Cette limite doit être affichée au propriétaire.

---

## 10. Modèle canonique des contenus

Le modèle interne peut être plus riche que Markdown. Il doit représenter au minimum :

- les pages et dossiers ;
- les blocs ;
- la hiérarchie ordonnée ;
- les propriétés ;
- les relations ;
- les bases de données ;
- les tâches ;
- les fichiers et pièces jointes ;
- les tableaux blancs ;
- l'historique ;
- les conflits ;
- la synchronisation ;
- les partages publics ;
- les annotations ;
- les permissions MCP.

Chaque objet synchronisable doit posséder :

- un identifiant stable et unique ;
- un type explicite ;
- des dates de création et de modification ;
- une information de version ou de causalité suffisante ;
- un état de suppression ou d'archivage lorsque pertinent ;
- les métadonnées nécessaires à la synchronisation et à la récupération.

Déplacer ou renommer un objet ne doit pas changer son identité ni casser silencieusement ses références.

Une référence vers une page n'est pas une relation de hiérarchie. Le modèle
doit distinguer explicitement :

- le **placement hiérarchique**, qui fait d'un élément un enfant visible sous
  un parent dans l'arborescence ;
- le **lien interne de page**, qui pointe vers un autre élément canonique sans
  le déplacer, le dupliquer ou en faire un enfant.

Les deux relations peuvent coexister pour une même paire d'éléments. Un lien
interne peut donc viser une page située ailleurs dans l'arborescence, y compris
un descendant, sans modifier l'arborescence. Les déplacements, renommages et
conversions doivent conserver l'identité de la cible et la résolution du lien.

---

## 11. Pages, dossiers et hiérarchie

Les pages et les dossiers ne sont pas deux objets de natures différentes. Ils
partagent un socle commun, et la page ajoute une capacité que le dossier n'a
pas.

Cette section disait auparavant « les pages et les dossiers sont deux objets
distincts ». C'était trompeur : cela laissait croire à deux familles séparées
alors qu'une page fait déjà tout ce que fait un dossier. La formulation
actuelle dit ce que l'application doit faire, et rend possible la conversion
décrite en 11.4.

### 11.1 Socle commun

Tout élément de la hiérarchie, page comme dossier, possède :

- un titre ;
- une position choisie par le propriétaire parmi ses frères ;
- une identité stable, que le renommage et le déplacement ne changent jamais ;
- des enfants dans la hiérarchie : sous-pages, sous-dossiers et fichiers
  autonomes rangés en dessous de lui.

Un dossier s'arrête à ce socle. Il n'a pas de contenu éditorial, et n'en aura
pas tant qu'il reste un dossier.

### 11.2 Ce que la page ajoute

Une page possède en plus un contenu éditorial : du texte, des blocs, des
tâches, des relations et des propriétés.

Elle porte de ce fait **deux relations distinctes**, qu'il ne faut pas
confondre :

- **ses enfants dans la hiérarchie** — sous-pages, sous-dossiers et fichiers
  autonomes rangés en dessous d'elle, exactement comme un dossier en range ;
- **ses pièces jointes de contenu** — les fichiers liés au texte de la page
  elle-même.

Le contenu de la page peut également contenir des **liens internes vers des
pages**. Ce sont des références non hiérarchiques : elles n'ajoutent aucun
enfant à la page et ne remplacent pas ses placements. Une page peut donc
contenir à la fois un enfant placé sous elle et un lien vers une autre page
située ailleurs.

L'interface expose les deux séparément : les enfants se déplient comme pour un
dossier, les pièces jointes de contenu par un bouton dédié. Un dossier n'a que
la première relation, puisqu'il n'a pas de contenu auquel rattacher quoi que ce
soit.

### 11.3 Opérations

Le propriétaire doit pouvoir :

- créer une page ou un dossier ;
- les renommer ;
- les déplacer où il veut dans la hiérarchie ;
- les réordonner librement parmi leurs frères ;
- déplacer une branche complète ;
- supprimer puis restaurer un élément ;
- distinguer visuellement une page d'un dossier ;
- convertir une page en dossier et un dossier en page (voir 11.4).

Le système doit empêcher les cycles de hiérarchie. Une opération portant sur une branche doit être atomique du point de vue de l'utilisateur ou reprendre proprement après une interruption.

### 11.4 Conversion entre page et dossier

Le propriétaire doit pouvoir changer d'avis. Une page dont il s'avère qu'elle
ne sert qu'à ranger doit pouvoir devenir un dossier ; un dossier auquel il veut
ajouter du texte doit pouvoir devenir une page.

Les deux sens ne se ressemblent pas.

**Dossier vers page** n'ajoute qu'une capacité. Rien n'est perdu, et aucune
confirmation n'est nécessaire.

**Page vers dossier est destructif** : le contenu éditorial de la page et les
pièces jointes liées à ce contenu disparaissent, puisqu'un dossier n'a nulle
part où les porter. Cette conversion doit donc :

- demander une confirmation explicite qui nomme ce qui va être supprimé ;
- rappeler que le retour en arrière n'est possible que pendant la durée de
  rétention de l'historique, et non indéfiniment ;
- rester récupérable par l'historique des révisions pendant cette durée.

**Dans les deux sens, sans exception**, l'identité de l'élément est conservée
et tout ce qui se trouve en dessous de lui dans la hiérarchie — sous-pages,
sous-dossiers et fichiers autonomes — reste intact et à sa place. Une
conversion n'est jamais une suppression suivie d'une création.

---

## 12. Barre latérale et navigation

La barre latérale gauche doit permettre :

- de parcourir l'arborescence ;
- d'ouvrir et fermer les branches ;
- de créer une page ou un dossier au bon emplacement ;
- de déplacer les éléments ;
- d'accéder aux favoris ;
- d'afficher les éléments récents ;
- de rechercher ;
- d'accéder aux réglages ;
- de voir l'état de connexion et de synchronisation.

Elle peut afficher au même niveau des pages, dossiers et fichiers autonomes.

Conformément à 11.2, une page expose **deux dépliages distincts** : ses enfants
dans la hiérarchie, comme un dossier, et un bouton discret pour ses pièces
jointes de contenu. Un dossier n'a que le premier. Confondre les deux ferait
disparaître de l'arbre les fichiers rangés sous une page, ou ferait apparaître
dans la hiérarchie des pièces jointes qui n'y sont pas.

Dans le contenu éditorial, un lien interne vers une page doit être
reconnaissable comme tel et ne doit jamais être rendu comme un enfant de
l'arborescence. L'interface peut utiliser une icône de lien pour ce type de
référence et une indication distincte pour les éléments placés sous la page.

La barre latérale doit aussi permettre de convertir une page en dossier et
inversement (11.4).

La navigation doit préserver le contexte lors d'un retour en arrière, prendre en charge le clavier et afficher des états explicites de chargement, de contenu vide, d'indisponibilité locale et d'erreur.

---

## 13. Éditeur par blocs

L'édition suit un modèle d'interaction proche de Notion. Le propriétaire peut insérer du contenu :

- avec `/` ;
- avec un clic droit ;
- avec un bouton d'insertion ;
- par glisser-déposer ;
- avec des raccourcis proches du Markdown.

Les blocs comprennent au minimum :

- texte ;
- titres ;
- listes ;
- cases à cocher ;
- citations ;
- code ;
- séparateurs ;
- liens ;
- images ;
- fichiers ;
- contenus intégrés.

Parmi les liens, l'éditeur doit distinguer les liens externes et les liens
internes vers des pages. Un lien interne conserve l'identifiant canonique de
sa cible, affiche son libellé dans le contenu et ouvre la cible sans créer de
placement hiérarchique. Les références internes doivent rester intactes après
un renommage, un déplacement ou une conversion de la cible ; leurs relations
inverses peuvent ensuite alimenter les backlinks.

Les blocs peuvent être sélectionnés, déplacés, transformés, dupliqués, regroupés et supprimés. Les actions d'édition courantes doivent être annulables et rétablissables.

L'expérience d'écriture doit ressembler au Markdown, mais les données n'ont pas besoin d'être stockées dans des fichiers `.md`.

L'éditeur doit préserver les changements locaux en cas de fermeture inattendue, signaler l'état de sauvegarde et ne jamais afficher un état « synchronisé » avant confirmation du serveur.

---

## 14. Bases de données et tâches

Les bases de données suivent le modèle mental de Notion. Une entrée est une page possédant des propriétés, par exemple :

- texte ;
- nombre ;
- date ;
- statut ;
- sélection ;
- sélection multiple ;
- case à cocher ;
- relation.

Les vues peuvent inclure :

- table ;
- Kanban ;
- galerie ;
- liste ;
- calendrier.

Les tâches peuvent exister :

- comme cases à cocher dans une page ;
- comme pages structurées ;
- avec statut, échéance, priorité et relations.

Les filtres, tris et regroupements enregistrés doivent produire le même résultat sur tous les clients compatibles.

---

## 15. Fichiers et pièces jointes

Un fichier peut être :

1. attaché à une page ;
2. intégré visuellement dans une page ;
3. placé directement dans la hiérarchie indépendamment d'une page ;
4. référencé dans le graphe ;
5. intégré dans un tableau blanc.

Les formats concernés incluent notamment :

- images ;
- PDF ;
- SVG ;
- Draw.io ;
- documents courants ;
- archives.

Un bouton discret sur une page affiche la liste complète de ses pièces jointes. Pour chaque fichier, cette liste peut indiquer :

- nom ;
- type ;
- taille ;
- date d'ajout ;
- emplacement ;
- utilisations ;
- état de disponibilité locale ;
- état de synchronisation ;
- actions disponibles.

Déplacer ou renommer un fichier ne doit pas casser ses références. La suppression d'un fichier encore utilisé doit afficher ses utilisations et demander une confirmation explicite.

Les transferts interrompus doivent être reprenables lorsque le protocole le permet. Un fichier ne doit être déclaré synchronisé qu'après vérification de son intégrité côté serveur.

La taille maximale d'un fichier doit être configurable par l'administrateur. La limite et le motif d'un refus doivent être affichés avant ou pendant le transfert sans entraîner la perte du brouillon associé.

La limite initiale par défaut est de 2 Go par fichier. Elle peut être modifiée par l'administrateur dans les limites réellement supportées par le reverse proxy, le navigateur, le stockage et le protocole de transfert.

---

## 16. Prévisualisation et édition des fichiers

L'application doit prévisualiser directement :

- PDF ;
- SVG ;
- PNG ;
- JPEG ;
- GIF ;
- WebP ;
- autres formats d'image courants ;
- Draw.io.

Les fichiers Draw.io doivent être prévisualisables et modifiables.

Lorsqu'un moteur d'édition mature existe, son intégration doit être privilégiée plutôt que de reconstruire inutilement la même fonctionnalité. L'intégration doit néanmoins respecter l'identité visuelle, les permissions, le hors-ligne et le modèle de sauvegarde de MyOwnNotion.

Un format non prévisualisable affiche au minimum son nom, son type, sa taille et une action de téléchargement ou d'ouverture externe.

Les contenus actifs ou potentiellement dangereux ne doivent pas être exécutés directement dans le contexte principal de l'application. Les prévisualisations doivent être isolées et les téléchargements servir un type de contenu sûr.

---

## 17. Stockage local par appareil

Chaque appareil conserve un ensemble chiffré de données locales pour permettre une utilisation rapide et hors ligne.

La limite par défaut est de 5 Go. Elle est modifiable depuis l'appareil concerné et peut être définie comme illimitée.

### 17.1 Toujours conservé localement

Le client conserve prioritairement :

- les métadonnées de navigation ;
- les titres ;
- les informations de synchronisation ;
- les modifications non synchronisées ;
- les conflits non résolus ;
- les contenus ouverts ou récents ;
- les contenus marqués « Toujours disponible hors ligne » ;
- les informations critiques nécessaires à l'accès.

L'action « Toujours disponible hors ligne » peut s'appliquer à :

- une page ;
- un dossier ou une branche ;
- un fichier.

### 17.2 Déchargement automatique

Lorsque la limite est atteinte, le client peut décharger :

- des fichiers volumineux ;
- des pièces jointes anciennes ;
- des pages synchronisées rarement consultées ;
- des contenus récupérables depuis le serveur.

Un contenu déchargé conserve son titre et ses métadonnées locales. Son contenu complet doit être retéléchargé depuis le serveur.

Ne peuvent jamais être déchargés automatiquement :

- les changements non synchronisés ;
- les conflits ;
- les éléments épinglés hors ligne ;
- les contenus dont la présence complète et l'intégrité sur le serveur ne sont pas confirmées.

La stratégie de déchargement associe récence, fréquence d'utilisation, taille et état de synchronisation. L'interface doit permettre d'expliquer pourquoi un élément est présent, épinglé ou déchargé.

### 17.3 Protection locale

- Le contenu applicatif doit être chiffré avant son écriture dans le stockage local.
- Les clés d'appareil doivent être protégées par les mécanismes sécurisés de la plateforme lorsqu'ils sont disponibles.
- Les clés ne doivent pas être exportables en clair.
- La déconnexion, la révocation ou le verrouillage doit effacer les clés en mémoire dès que possible.
- Le cache du navigateur ne doit jamais être considéré comme l'unique copie durable d'une donnée.
- Sur le Web, le client doit demander le stockage persistant lorsque possible et afficher les limites imposées par le navigateur.

---

## 18. Fonctionnement hors ligne

Hors ligne, le propriétaire peut :

- consulter les contenus disponibles localement ;
- créer des pages ;
- modifier les notes ;
- déplacer des éléments ;
- ajouter des tâches ;
- ajouter des fichiers dans la limite du stockage disponible ;
- préparer des changements à synchroniser.

L'interface indique clairement :

- que l'appareil est hors ligne ;
- que certains contenus ne sont pas disponibles localement ;
- que des changements attendent une synchronisation ;
- la date de la dernière synchronisation réussie ;
- les erreurs empêchant une synchronisation.

L'application ne doit jamais annoncer qu'une donnée est présente sur le serveur lorsqu'elle ne l'est que localement.

Après une fermeture inattendue, tout changement confirmé localement doit être récupéré au prochain démarrage. Les opérations hors ligne doivent être rejouables de manière idempotente afin qu'une reconnexion ne crée pas de doublons.

---

## 19. Synchronisation et temporalité

La synchronisation doit donner une sensation de direct. Lorsqu'un appareil connecté modifie une donnée, les autres appareils connectés doivent recevoir le changement selon la cible mesurable définie en section 43.1.

Les fondations doivent permettre :

- les connexions persistantes ;
- la reconnexion automatique ;
- la reprise après interruption ;
- le rattrapage après une longue absence ;
- l'absence d'événement perdu ;
- la synchronisation des fichiers et relations ;
- un état de synchronisation visible ;
- l'idempotence des nouvelles tentatives ;
- la compatibilité contrôlée entre versions de clients et de serveur.

Un appareil simplement en retard ne doit pas générer de faux conflit. Un conflit existe seulement lorsque le même contenu a évolué indépendamment sur plusieurs appareils depuis leur dernier état commun.

### 19.1 États visibles

Chaque contenu modifiable doit pouvoir présenter au moins les états suivants lorsque pertinent :

- enregistré localement ;
- en attente de synchronisation ;
- synchronisation en cours ;
- synchronisé ;
- erreur récupérable ;
- conflit nécessitant une action.

### 19.2 Compatibilité

Le serveur doit annoncer une version de protocole. Un client incompatible doit refuser une synchronisation risquant de corrompre les données et expliquer la mise à jour nécessaire. Une fenêtre de compatibilité doit être documentée pour chaque version publiée.

Par défaut, une version stable du serveur doit accepter le client stable correspondant et la version stable immédiatement précédente tant que leur protocole reste compatible. Un client plus ancien peut être placé en lecture seule si les lectures sont sûres, mais aucune écriture incompatible ne doit être acceptée.

---

## 20. Historique et résolution des conflits

Les changements compatibles doivent être fusionnés automatiquement.

Lorsqu'une fusion sûre est impossible, un écran comparatif inspiré des conflits Git permet :

- d'afficher la version locale ;
- d'afficher la version distante ;
- de voir leur état commun ;
- de choisir des parties de chaque version ;
- de fusionner les deux ;
- de réorganiser manuellement le résultat ;
- de vérifier avant validation ;
- de conserver les versions originales.

Aucune donnée ne doit être détruite avant la résolution. La résolution elle-même doit produire une nouvelle version sans altérer les versions sources.

L'historique doit permettre d'identifier au minimum la date, l'appareil et la nature d'une modification. Il ne doit pas enregistrer de secret technique en clair.

---

## 21. Recherche

La recherche couvre progressivement :

- les titres ;
- le contenu des pages ;
- les propriétés ;
- les tâches ;
- les noms de fichiers ;
- les relations ;
- le contenu indexable des pièces jointes.

Une page déchargée reste trouvable localement par son titre et ses métadonnées. Une recherche dans son contenu complet nécessite le serveur ou le téléchargement préalable du contenu.

Les résultats doivent respecter les périmètres privés, publics et MCP. Aucun index, extrait ou message d'erreur ne doit révéler un contenu hors du périmètre autorisé.

Les index contenant des données sensibles sont soumis aux mêmes exigences de chiffrement, de sauvegarde, de restauration et de suppression que les contenus sources.

---

## 22. Graphe de connaissances

Le graphe représente les relations entre :

- pages ;
- dossiers lorsqu'ils structurent un périmètre ;
- bases de données ;
- tâches ;
- fichiers ;
- pièces jointes ;
- tableaux blancs lorsque pertinent.

Le propriétaire peut choisir un périmètre :

- espace complet ;
- dossier et descendants ;
- page et relations ;
- sélection manuelle ;
- voisinage sur plusieurs niveaux.

Il peut filtrer par :

- type de contenu ;
- type de relation ;
- pièce jointe ;
- format ;
- propriété ;
- statut ;
- branche de contenu ;
- profondeur ;
- dates ;
- éléments isolés.

Les filtres sont combinables, visibles et réinitialisables. Le graphe ne doit pas créer une seconde source de vérité : il visualise les objets et relations canoniques.

---

## 23. Tableaux blancs

Un tableau blanc peut contenir :

- pages existantes ;
- représentations de pages ;
- fichiers ;
- images ;
- cartes ;
- texte ;
- connexions ;
- dessins à la main.

Une page intégrée reste liée à sa source et ne devient pas une copie indépendante.

Un moteur existant peut être intégré et personnalisé s'il évite de reconstruire inutilement une solution complète. Son format doit être versionné, exportable et compatible avec les sauvegardes.

---

## 24. Partage public

Le propriétaire peut partager :

- une page ;
- un dossier.

Lors du partage d'une page possédant des sous-pages, l'interface demande si les sous-pages doivent être incluses. Lors du partage d'un dossier, elle demande quels descendants doivent être inclus.

Le partage crée un lien public accessible sans compte. Le propriétaire peut :

- copier le lien ;
- définir une expiration optionnelle ;
- définir un mot de passe optionnel ;
- inclure ou exclure les descendants ;
- inclure ou exclure les pièces jointes ;
- autoriser ou interdire les annotations ;
- régénérer le lien ;
- désactiver immédiatement le partage.

La page publique affiche les modifications en direct et ne repose pas sur une copie publiée manuellement.

Un visiteur ne peut jamais remonter vers un parent privé, utiliser une relation pour sortir du périmètre partagé ou découvrir un contenu privé dans des métadonnées, prévisualisations, erreurs ou résultats de recherche.

La désactivation d'un partage doit couper immédiatement les nouveaux accès. Les caches contrôlés par l'application doivent être invalidés ; l'interface doit expliquer que les copies déjà téléchargées par un visiteur ne peuvent pas être effacées à distance.

Les accès publics doivent être limités contre les abus sans empêcher un usage humain normal.

---

## 25. Annotations publiques

Pour annoter un passage, le visiteur fournit une adresse e-mail au format valide. L'adresse n'est pas vérifiée et aucun compte n'est créé.

L'annotation :

- cible un passage de texte ;
- est publiée immédiatement ;
- apparaît dans l'interface du propriétaire ;
- peut être retrouvée depuis un bouton dédié ;
- peut être masquée, supprimée ou résolue ;
- ne donne jamais accès à l'édition de la page.

Si le passage est modifié, l'application tente de maintenir l'ancrage. Si cela devient impossible, l'annotation est conservée et signalée comme détachée plutôt que supprimée.

Les adresses e-mail des visiteurs sont des données privées. Elles ne doivent pas être affichées publiquement, indexées par un moteur de recherche, placées dans les journaux ou utilisées à une autre fin sans consentement.

Un mécanisme de limitation et de modération doit protéger les annotations contre le spam et les contenus abusifs.

---

## 26. Serveur MCP

Le serveur MCP est géré depuis les réglages.

Le propriétaire génère un jeton temporaire. L'assistant ouvre une page d'autorisation et échange ce jeton contre un accès dédié.

Chaque accès possède des permissions explicites :

- recherche ;
- lecture ;
- création ;
- modification ;
- suppression ;
- branches de contenu autorisées ;
- fichiers autorisés.

Le propriétaire peut consulter et révoquer chaque connexion. La révocation empêche immédiatement toute nouvelle communication.

Les jetons temporaires doivent expirer rapidement, être à usage unique et ne jamais apparaître dans les journaux. Les identifiants MCP persistants doivent être révocables, renouvelables et stockés sous une forme protégée.

Un jeton temporaire d'autorisation expire par défaut après dix minutes. Un accès MCP persistant expire par défaut après 90 jours, avec possibilité pour le propriétaire de choisir une durée plus courte ou une absence d'expiration explicitement avertie.

Chaque opération MCP sensible doit être attribuable à une connexion, visible dans un journal d'audit et soumise aux mêmes règles d'intégrité que l'interface principale.

---

## 27. Export, import et portabilité

L'export Markdown n'est pas une exigence obligatoire.

Un export complet, durable, versionné et documenté est obligatoire. Il inclut :

- les contenus ;
- la hiérarchie ;
- les relations ;
- les propriétés ;
- les tâches ;
- les pièces jointes ;
- les tableaux blancs ;
- les métadonnées nécessaires à la compréhension des données ;
- un manifeste décrivant le format et la version.

L'export ne doit pas inclure de secret d'authentification, clé privée, session active ou jeton MCP.

La V1 doit au minimum pouvoir vérifier l'intégrité d'un export et documenter comment le lire. Elle doit aussi fournir une voie testée permettant de réimporter ou de restaurer les données dans une installation compatible sans perte des éléments annoncés comme portables.

Le format d'export V1 est une archive documentée contenant au minimum un manifeste JSON UTF-8 versionné, les objets canoniques en JSON, les fichiers dans une arborescence portable et une somme de contrôle pour chaque élément. Les noms originaux sont conservés dans le manifeste même lorsqu'ils doivent être normalisés sur le système de fichiers cible.

L'export peut être chiffré à la demande. Si un export chiffré est produit, son mécanisme de récupération doit être documenté séparément des données.

---

## 28. Chiffrement des données et gestion des clés

### 28.1 Données en transit

- Tous les accès exposés hors du réseau local doivent utiliser HTTPS ou un canal offrant une protection équivalente.
- Les WebSockets, API, téléchargements, synchronisations et accès MCP suivent la même exigence.
- Le reverse proxy externe termine TLS et transmet au serveur les informations de protocole de manière contrôlée.
- Le serveur ne doit faire confiance qu'aux proxys explicitement configurés.

### 28.2 Données au repos sur le serveur

Les contenus sensibles doivent être chiffrés par l'application avant leur stockage persistant, notamment :

- contenu des pages et blocs ;
- propriétés et relations sensibles ;
- fichiers et pièces jointes ;
- index de recherche révélant le contenu ;
- historique et versions ;
- annotations et adresses e-mail ;
- secrets d'intégration récupérables.

Le chiffrement doit être authentifié afin de détecter une modification des données. Chaque donnée chiffrée doit indiquer la version du format et de la clé utilisée.

La clé maîtresse ou clé d'enveloppement :

- est fournie au déploiement comme secret externe aux données ;
- ne doit pas être inscrite dans l'image, le dépôt, la base de données ou les journaux ;
- ne doit pas être stockée en clair dans le fichier `.env` lorsque le moteur de déploiement permet un mécanisme de secrets ;
- doit pouvoir être remplacée selon une procédure documentée et testée.

Le serveur peut déchiffrer les données lorsqu'il fonctionne avec les clés autorisées. Une architecture « zero knowledge », dans laquelle le serveur serait incapable de lire les contenus, n'est pas exigée.

Les volumes peuvent être protégés en plus par le chiffrement du disque, du système de fichiers ou de la plateforme d'hébergement. Cette seconde couche est recommandée et doit être documentée, mais elle ne remplace pas le chiffrement applicatif.

### 28.3 Données locales

Chaque client doit chiffrer les contenus, fichiers, index et files d'opérations qu'il conserve localement. Les clés propres à l'appareil doivent être protégées par le magasin sécurisé fourni par le système d'exploitation lorsque celui-ci existe.

Sur une plateforme Web qui ne permet pas une garantie équivalente, l'application doit chiffrer les données avant leur stockage et documenter clairement les limites de protection liées au navigateur et à une session déjà ouverte.

### 28.4 Kit de récupération

Lors de l'initialisation, l'application doit générer un kit de récupération chiffré permettant au propriétaire autorisé de restaurer l'accès aux clés nécessaires.

Le kit :

- doit être exportable et conservable hors ligne ;
- ne doit pas être envoyé automatiquement vers le même stockage que les données chiffrées ;
- doit être accompagné d'une procédure de conservation et de test ;
- doit demander une confirmation de sauvegarde avant que l'installation soit considérée comme prête ;
- doit pouvoir être remplacé après une authentification renforcée ;
- doit identifier la version du format et les installations auxquelles il s'applique.

Le remplacement ou la rotation doit invalider les anciens moyens de récupération lorsque cela est annoncé, sans rendre les sauvegardes historiques irrécupérables. La stratégie d'enveloppement des anciennes clés doit donc être documentée et testée.

La clé d'enveloppement doit être renouvelée au minimum une fois par an et immédiatement après toute suspicion de compromission. La rotation ne doit pas imposer le déchiffrement simultané de toutes les données si une stratégie progressive sûre est disponible.

### 28.5 Échec sécurisé

- Une clé absente ou incorrecte doit empêcher le démarrage des services manipulant les données plutôt que produire des données illisibles ou partielles.
- Une erreur de déchiffrement doit être signalée comme une erreur d'intégrité et ne doit pas être contournée silencieusement.
- Les migrations de chiffrement doivent être reprises, observables et réversibles.

---

## 29. Sécurité et confidentialité

Le modèle de menace doit couvrir au minimum :

- attaquant Internet visant les pages publiques ou l'authentification ;
- application cliente ou jeton MCP compromis ;
- appareil perdu ;
- copie non autorisée d'un volume ou d'une sauvegarde ;
- dépendance ou image conteneur compromise ;
- contenu de fichier malveillant ;
- erreur d'exploitation ou mauvaise configuration.

Le produit doit mettre en œuvre :

- validation stricte des entrées ;
- protection contre les injections, XSS, CSRF et traversées de chemins ;
- politique de sécurité des contenus adaptée ;
- limitation des tentatives d'authentification et des accès publics abusifs ;
- contrôle d'accès systématique côté serveur ;
- séparation des données privées, publiques et autorisées par MCP ;
- analyse des dépendances et des images ;
- gestion documentée des vulnérabilités.

Les journaux ne doivent jamais contenir :

- le contenu des notes ;
- les mots de passe ;
- les clés de chiffrement ;
- les kits de récupération ;
- les jetons de session ou MCP ;
- les adresses e-mail publiques en clair, sauf diagnostic explicitement autorisé et expurgé.

Aucune télémétrie externe n'est activée par défaut. Toute télémétrie future doit être facultative, explicite, documentée et désactivable.

---

## 30. Sauvegardes

Une sauvegarde automatique est exécutée chaque jour à 4 h selon le fuseau horaire configuré sur le serveur.

Elle contient :

- contenus ;
- pages et dossiers ;
- bases de données ;
- relations ;
- fichiers ;
- pièces jointes ;
- réglages nécessaires ;
- métadonnées de version ;
- informations de restauration ;
- versions des schémas et formats chiffrés ;
- manifeste d'intégrité.

La destination distante initiale est Google Drive. L'intégration doit isoler le fournisseur afin de permettre l'ajout ultérieur d'autres destinations.

La sauvegarde doit être chiffrée avant son envoi : Google Drive ne doit pas pouvoir lire son contenu.

Chaque sauvegarde doit être :

- cohérente ;
- chiffrée avant transfert ;
- vérifiée après création et après transfert ;
- associée à une version de l'application ;
- restaurable ;
- testable sans écraser l'installation active ;
- observable depuis l'interface et les commandes administratives.

La rétention par défaut est de trois mois et reste configurable. La suppression distante suit la politique de rétention seulement après confirmation qu'au moins une sauvegarde récente et vérifiée reste disponible.

Le propriétaire doit être averti de manière visible si aucune sauvegarde vérifiée n'a réussi depuis plus de 26 heures.

Le kit de récupération et les secrets nécessaires ne doivent pas être sauvegardés en clair avec les données. La documentation doit expliquer précisément ce qui est nécessaire pour restaurer sur une nouvelle machine.

---

## 31. Restauration et reprise après incident

La restauration doit pouvoir être exécutée :

- dans un environnement isolé pour test ;
- sur une installation vide ;
- après perte du serveur ;
- vers une version explicitement compatible.

Avant une restauration destructive, le système doit :

1. vérifier l'accès aux clés ;
2. vérifier le manifeste et l'intégrité des archives ;
3. vérifier la compatibilité de version ;
4. afficher la portée et la date des données restaurées ;
5. créer une sauvegarde de sécurité de l'état actuel lorsque possible ;
6. demander une confirmation explicite.

Une restauration échouée ne doit pas laisser l'installation dans un état présenté comme sain. Les étapes doivent être reprises ou annulées selon une procédure documentée.

Une restauration de test automatisée ou guidée doit être réalisée régulièrement. La CI doit aussi vérifier la restauration de sauvegardes de référence compatibles avec les migrations prises en charge.

En production, le propriétaire doit être invité à effectuer au minimum une restauration de test par mois. L'application doit mémoriser la date et le résultat du dernier test sans conserver de secret.

---

## 32. Mises à jour, migrations et retour arrière

Avant toute mise à jour :

1. le changement d'image ou de version est détecté ;
2. la version actuelle est enregistrée ;
3. une sauvegarde cohérente est créée ;
4. elle est associée à la version actuelle ;
5. elle est vérifiée ;
6. si la sauvegarde échoue, la mise à jour échoue ;
7. si sa vérification échoue, la mise à jour échoue ;
8. la migration commence uniquement après validation.

Le système doit conserver les informations permettant de revenir :

- à l'image précédente ;
- au format de données précédent lorsque la migration est réversible ;
- à la sauvegarde correspondante.

Chaque migration doit être :

- versionnée ;
- testée depuis toutes les versions encore prises en charge ;
- idempotente ou protégée contre une double exécution ;
- observable ;
- accompagnée d'une stratégie explicite de retour arrière ou de restauration.

Une mise à jour ne doit jamais être annoncée comme réussie avant le passage des contrôles de santé et d'intégrité.

---

## 33. Suppression, corbeille et rétention

La suppression ordinaire place les contenus dans une corbeille restaurable pendant 30 jours par défaut. Cette durée est configurable. L'historique des versions est conservé pendant 90 jours par défaut et peut être configuré comme illimité, sous réserve de l'espace disponible.

La suppression définitive doit :

- exiger une confirmation explicite ;
- expliquer les références affectées ;
- être synchronisée sur les appareils ;
- retirer les données des index actifs ;
- respecter les contraintes techniques des sauvegardes et leur rétention ;
- ne pas prétendre effacer des copies déjà téléchargées sur un appareil inaccessible ou par un visiteur public.

La désactivation d'un partage, la révocation d'un appareil et la suppression d'un contenu sont des opérations distinctes et ne doivent pas être confondues dans l'interface.

---

## 34. Commandes administratives

Le serveur fournit des commandes administratives lancées depuis l'environnement Compose. Elles permettent au minimum :

- de réinitialiser le mot de passe ;
- de révoquer les sessions ;
- de vérifier l'intégrité des données ;
- de vérifier la disponibilité des clés sans les afficher ;
- de déclencher une sauvegarde ;
- de tester une restauration ;
- d'inspecter la version et la compatibilité ;
- de lancer ou inspecter les migrations ;
- de faire tourner les clés selon une procédure sûre ;
- d'exécuter une réparation documentée ;
- de produire un diagnostic expurgé.

Chaque commande doit posséder une aide intégrée, un code de sortie fiable et un mode non interactif lorsque nécessaire à l'automatisation. Les commandes destructives doivent proposer une simulation ou demander une confirmation explicite.

---

## 35. Observabilité et audit

Le produit doit exposer localement :

- un contrôle de vie du processus ;
- un contrôle de disponibilité réelle du service ;
- l'état de la base de données et des migrations ;
- l'état de la file de synchronisation ;
- la date et le résultat de la dernière sauvegarde ;
- la version de chaque composant ;
- des métriques utiles à l'exploitation sans contenu utilisateur.

Les journaux doivent être structurés, horodatés, associés à un niveau et dotés d'un identifiant de corrélation lorsque plusieurs services participent à une opération.

Un journal d'audit doit couvrir au minimum :

- connexions et échecs d'authentification ;
- ajout ou révocation d'un appareil ;
- modification des méthodes d'authentification ;
- création, modification ou révocation d'un partage ;
- création ou révocation d'un accès MCP ;
- sauvegardes et restaurations ;
- migrations et mises à jour ;
- rotation des clés ;
- opérations administratives sensibles.

Le propriétaire doit pouvoir exporter un paquet de diagnostic expurgé. Ce paquet ne doit jamais inclure de contenu utilisateur ou de secret sans une action distincte et explicitement avertie.

---

## 36. Déploiement officiel avec Compose

Le serveur est officiellement déployé avec Docker Compose.

Compose doit permettre :

- de lancer et arrêter le produit ;
- de mettre à jour les images ;
- d'exécuter les commandes administratives ;
- de sauvegarder ;
- de restaurer ;
- d'inspecter les services et leur santé ;
- de construire les images localement pour le diagnostic.

### 36.1 Stack complète

Le dépôt doit fournir un fichier `compose.yaml` contenant tous les services nécessaires au fonctionnement normal de l'application. Après configuration des variables et secrets obligatoires, une commande documentée doit lancer une installation fonctionnelle.

Si plusieurs services sont nécessaires, chaque responsabilité indépendante possède son conteneur. Cette séparation ne doit pas créer artificiellement une architecture complexe.

Chaque service doit définir lorsque pertinent :

- une image explicitement versionnée ;
- un contrôle de santé ;
- une politique de redémarrage ;
- ses dépendances réelles ;
- des limites ou recommandations de ressources ;
- les volumes persistants ;
- un utilisateur non privilégié ;
- les secrets et variables strictement nécessaires.

Les volumes persistants doivent être nommés, documentés et survivre au remplacement des conteneurs. Aucun contenu durable ne doit dépendre de la couche écrivable d'un conteneur.

### 36.2 Réseau et reverse proxy

- L'application sert le protocole HTTP dans le réseau local ou le réseau Compose.
- La stack officielle n'a pas à obtenir ni renouveler des certificats TLS.
- Un reverse proxy externe assure HTTPS, le nom de domaine et l'exposition sur Internet.
- Le port publié par défaut doit être lié à l'interface de boucle locale lorsque cela permet au reverse proxy de fonctionner.
- L'adresse d'écoute peut être rendue configurable avec un avertissement de sécurité.
- L'URL publique, les origines autorisées, les en-têtes de proxy fiables et les limites de taille doivent être configurables.
- La documentation doit fournir des exemples pour plusieurs reverse proxys courants sans en rendre un obligatoire.

Les fonctions nécessitant une URL publique, comme les partages et certains flux MCP, doivent détecter l'absence de configuration publique et expliquer le prérequis.

### 36.3 Démarrage et santé

Le démarrage doit :

1. vérifier la présence des variables et secrets obligatoires ;
2. refuser les valeurs manifestement dangereuses ou par défaut en production ;
3. vérifier l'accès aux volumes et à la clé de chiffrement ;
4. appliquer uniquement les migrations prévues ;
5. attendre les dépendances réellement prêtes ;
6. exposer un état sain uniquement lorsque l'application est utilisable.

---

## 37. Configuration, `.env` et secrets

Le dépôt doit fournir :

- un `.env.example` versionné contenant toutes les variables prises en charge, sans secret réel ;
- une documentation indiquant pour chaque variable son rôle, son caractère obligatoire, sa valeur par défaut et un exemple sûr ;
- un mécanisme documenté pour créer le `.env` local ;
- des fichiers de secrets ou mécanismes Compose compatibles pour les clés sensibles ;
- une validation de configuration exécutée avant le démarrage.

Le véritable fichier `.env` :

- est propre à chaque installation ;
- ne doit jamais être commité ;
- doit être ignoré par Git ;
- ne doit pas contenir la clé maîtresse en clair si un secret monté peut être utilisé ;
- doit pouvoir être recréé à partir de `.env.example` et de la documentation.

La configuration doit distinguer au minimum :

- environnement de développement, de test et de production ;
- URL locale et URL publique ;
- ports et interfaces d'écoute ;
- base de données et stockage de fichiers ;
- clé de chiffrement ou chemin du secret ;
- destination et rétention des sauvegardes ;
- fuseau horaire ;
- limites de fichiers et de stockage ;
- niveau de journalisation ;
- origines et proxys de confiance ;
- références des images et version à déployer.

Les valeurs obsolètes doivent produire un avertissement avant leur suppression dans une version majeure. Les changements incompatibles de configuration doivent être documentés dans les notes de version.

---

## 38. Environnement de développement local

En développement :

- le projet doit pouvoir être lancé localement ;
- les services doivent se recharger automatiquement après modification lorsque pertinent ;
- les données de développement doivent être séparées des données de test et de production ;
- les erreurs doivent être visibles rapidement ;
- les images et applications doivent pouvoir être construites localement ;
- aucune dépendance à un secret de production ne doit être nécessaire ;
- un jeu de données de démonstration non sensible doit pouvoir être créé ;
- une commande documentée doit exécuter l'ensemble des contrôles locaux obligatoires.

Les commandes utilisées localement et en CI doivent appeler les mêmes scripts de projet afin d'éviter deux comportements divergents.

La documentation de démarrage doit partir d'une machine propre et décrire :

1. les prérequis ;
2. la création de la configuration ;
3. le lancement ;
4. la création des données de développement ;
5. l'exécution des tests ;
6. l'arrêt et le nettoyage ciblé ;
7. les problèmes courants.

---

## 39. Processus obligatoire de développement

Toute modification fonctionnelle suit ce processus :

1. partir d'un état à jour de la branche principale ;
2. travailler sur une branche dédiée ;
3. développer la modification et ses tests ;
4. exécuter localement tous les contrôles obligatoires ;
5. corriger jusqu'à ce que les contrôles locaux réussissent ;
6. pousser la branche sur GitHub ;
7. ouvrir une pull request — le push d'une branche de travail ne déclenche aucune CI par lui-même ;
8. laisser la CI de pull request exécuter les contrôles dans un environnement propre ;
9. corriger tout échec et obtenir une nouvelle CI réussie ;
10. effectuer la revue requise ;
11. fusionner uniquement lorsque toutes les conditions obligatoires sont satisfaites.

La séquence de référence est donc :

`développement → contrôles locaux réussis → push → pull request → CI de PR réussie → revue → fusion`

Les contrôles locaux sont donc la porte avant la pull request ; la pull request est la première porte automatisée.

Les règles suivantes sont obligatoires :

- aucun push direct sur `main` en dehors des mécanismes administratifs d'urgence documentés ;
- aucun contournement d'un contrôle requis sans justification et trace explicites ;
- aucune fusion avec une CI en échec, annulée ou obsolète ;
- la branche doit être à jour selon la politique choisie avant fusion ;
- les commits et artefacts doivent rester attribuables ;
- les changements de schéma, sécurité, sauvegarde ou chiffrement exigent une revue renforcée.

Les corrections urgentes suivent le même niveau de contrôle ; si une mesure exceptionnelle est nécessaire, les tests et la revue manquants doivent être rétablis immédiatement après l'incident et documentés.

---

## 40. Intégration continue obligatoire

GitHub Actions est la plateforme CI officielle.

### 40.1 Déclencheurs

Les workflows doivent s'exécuter :

- sur chaque ouverture, mise à jour ou réouverture de pull request ;
- sur chaque push vers `main` ;
- sur chaque tag de version ;
- manuellement pour les diagnostics et opérations prévues.

Le push d'une branche de travail ne doit déclencher aucun contrôle requis ;
les contrôles locaux exécutés avant le push en tiennent lieu, et la pull
request est la première porte automatisée.

### 40.2 Contrôles requis

La CI doit exécuter selon le périmètre affecté :

- vérification du formatage ;
- lint et analyse statique ;
- vérification des types ;
- tests unitaires ;
- tests fonctionnels ;
- tests d'intégration ;
- tests Playwright ;
- tests hors ligne et de synchronisation ;
- tests de conflits ;
- tests de sauvegarde et restauration ;
- tests de migrations montantes et de retour prévu ;
- construction des applications ;
- construction des images conteneurisées ;
- validation de `compose.yaml` et `.env.example` ;
- démarrage réel de la stack et contrôles de santé ;
- analyse des dépendances ;
- recherche de secrets ;
- analyse statique de sécurité ;
- analyse des images de conteneurs ;
- génération d'un inventaire logiciel lorsque requis pour une publication ;
- vérification des licences incompatibles.

Un contrôle requis qui n'a pas été exécuté est considéré comme non réussi. Les exclusions doivent être explicites, minimales et documentées.

### 40.3 Fiabilité de la CI

- Les dépendances et actions GitHub doivent être épinglées de manière sûre.
- Les permissions des workflows doivent être minimales.
- Les secrets de publication ne doivent être accessibles qu'aux événements de confiance.
- Les tests doivent être isolés et reproductibles.
- Les tests instables doivent être corrigés ; les relances ne doivent pas masquer un défaut.
- Les résultats, journaux et rapports utiles doivent être conservés comme artefacts pendant une durée documentée.
- La CI doit annuler les exécutions devenues obsolètes lorsque cela ne masque pas un résultat nécessaire.

### 40.4 Protection de `main`

La branche `main` doit être protégée avec au minimum :

- pull request obligatoire ;
- contrôles CI requis ;
- conversation de revue résolue ;
- refus des branches dont les contrôles ne correspondent pas au dernier commit ;
- interdiction de suppression et de réécriture d'historique pour les contributeurs ordinaires.

---

## 41. Construction et publication des images

GitHub Actions doit construire :

- les images conteneurisées utilisées par Compose ;
- les applications de bureau lorsque leur phase est active ;
- les artefacts distribuables nécessaires ;
- les manifestes, inventaires et attestations associés aux publications.

Chaque artefact doit être associé à un commit et à une version identifiable. Les mêmes constructions doivent fonctionner localement pour le développement et le diagnostic.

### 41.1 Push sur `main`

Après réussite de toute la CI sur un push vers `main` :

- les images destinées à Compose doivent être construites ;
- elles doivent être publiées dans GitHub Container Registry ;
- elles doivent recevoir un tag immuable dérivé du SHA du commit ;
- un alias de canal `main` peut pointer vers la dernière image réussie ;
- aucune image ne doit être publiée si un contrôle obligatoire échoue.

### 41.2 Tag de version

Lorsqu'un tag de version conforme à la convention du projet est poussé :

- la CI complète doit être rejouée ou vérifiée sur le commit exact ;
- les images doivent être publiées avec le numéro de version ;
- les artefacts distribuables doivent être joints à une publication GitHub ;
- les sommes de contrôle doivent être publiées ;
- les notes de version doivent décrire les migrations, compatibilités et ruptures ;
- le canal stable ne doit être mis à jour que pour une version non préliminaire réussie.

### 41.3 Utilisation par Compose

Le Compose officiel doit référencer les images GitHub publiées et permettre de sélectionner une version avec une variable documentée. Une installation de production doit pouvoir épingler une version immuable et revenir à la version précédente.

Les plateformes serveur officiellement prises en charge doivent disposer d'images correspondantes. Au minimum, la stratégie de prise en charge de `linux/amd64` et `linux/arm64` doit être documentée avant la V1.

---

## 42. Stratégie de tests

Tous les comportements essentiels et tous ceux dont l'échec peut causer une perte de données, un accès non autorisé, une incompatibilité ou une restauration impossible doivent être couverts par des tests automatisés adaptés.

### 42.1 Tests unitaires

Ils couvrent notamment :

- règles métier ;
- transformations de données ;
- permissions ;
- historique ;
- fusion ;
- synchronisation ;
- chiffrement ;
- sauvegardes ;
- migrations ;
- sérialisation et validation des configurations.

### 42.2 Tests fonctionnels et d'intégration

Ils couvrent notamment :

- communication entre services ;
- persistance ;
- API ;
- stockage ;
- export et import ;
- restauration ;
- mises à jour ;
- reconnexion ;
- conflits ;
- rotation des clés ;
- révocation des appareils et accès MCP ;
- démarrage de la stack Compose.

### 42.3 Tests Playwright

Les parcours utilisateur importants doivent être testés avec Playwright, notamment :

- responsive ;
- pages et dossiers ;
- éditeur ;
- fichiers ;
- authentification ;
- mode hors ligne ;
- synchronisation ;
- conflits ;
- appareils ;
- partage public ;
- annotations ;
- sauvegardes ;
- restauration guidée lorsque testable ;
- réglages MCP ;
- erreurs, états vides et chargements.

### 42.4 Tests de données critiques

Des scénarios dédiés doivent prouver :

- qu'une modification hors ligne survit à un redémarrage ;
- qu'une nouvelle tentative ne duplique pas une opération ;
- qu'un fichier déplacé conserve ses références ;
- qu'un conflit conserve toutes les versions ;
- qu'une sauvegarde vérifiée peut être restaurée sur une installation vide ;
- qu'une migration interrompue reprend ou revient à un état sûr ;
- qu'une clé incorrecte ne corrompt pas les données ;
- qu'un appareil ou jeton révoqué ne récupère plus de données ;
- qu'un partage public ne révèle aucun parent ou contenu privé.

Une fonctionnalité n'est pas terminée si ses comportements essentiels ne sont pas testés.

---

## 43. Critères non fonctionnels initiaux

Les valeurs suivantes constituent des cibles d'acceptation initiales. Toute modification doit être justifiée par des mesures et enregistrée dans la spécification concernée.

### 43.1 Performance perçue

- Une saisie ou opération locale courante ne doit pas attendre le réseau pour être confirmée localement.
- Sur un appareil de référence, l'interface doit répondre aux interactions courantes sans blocage perceptible prolongé.
- Pour deux appareils connectés dans des conditions réseau normales, une modification textuelle synchronisée doit apparaître sur l'autre appareil en moins de deux secondes dans au moins 95 % des cas mesurés.
- Les opérations longues doivent afficher une progression et rester annulables lorsque cela est sûr.

### 43.2 Durabilité et récupération

- Une donnée confirmée comme enregistrée localement doit survivre à un arrêt brutal simulé.
- La perte du réseau ne doit pas entraîner de perte de modification locale.
- L'objectif de point de reprise distant est au maximum de 26 heures avec la sauvegarde quotidienne, hors changements encore uniquement locaux.
- Une restauration de référence doit être testée avant chaque version stable.

### 43.3 Capacité et montée en charge

Le produit reste mono-utilisateur, mais doit être validé avec des volumes réalistes et croissants. Le jeu de référence V1 comprend au minimum :

- 100 000 pages ;
- 1 000 000 de blocs ;
- 100 000 relations ;
- 50 000 fichiers représentant jusqu'à 500 Go ;
- 10 appareils autorisés ;
- plusieurs années d'historique synthétique.

Les tests peuvent utiliser des contenus générés et des fichiers creux lorsque cela ne fausse pas la mesure évaluée. Les limites matérielles de l'environnement de CI doivent être distinguées des limites fonctionnelles du produit.

Aucune limite arbitraire silencieuse ne doit être introduite. Les limites nécessaires doivent être configurables ou explicitement documentées avec un message exploitable.

Le serveur n'impose pas de quota global applicatif par défaut. Il doit avertir à 80 % puis de manière critique à 90 % de l'espace de stockage disponible, sans prétendre pouvoir poursuivre une écriture qui risquerait d'être incomplète.

### 43.4 Accessibilité

- Les parcours V1 doivent être utilisables au clavier.
- Les composants doivent exposer des noms, rôles et états accessibles.
- Les contrastes et indicateurs ne doivent pas dépendre uniquement de la couleur.
- Le zoom, les tailles de texte et la réduction des animations doivent être respectés.
- La cible est WCAG 2.2 niveau AA pour les parcours essentiels de la V1.

### 43.5 Internationalisation

La V1 doit fournir une interface française cohérente et préparer l'externalisation des textes pour d'autres langues. Les dates, heures, nombres, fuseaux horaires et tris doivent utiliser des règles explicites et testées.

---

## 44. Définition de terminé

Une fonctionnalité ou modification n'est terminée que si :

- son comportement et son hors-périmètre sont spécifiés ;
- ses critères d'acceptation sont vérifiables ;
- les cas d'erreur, hors ligne et reprise sont couverts ou marqués non applicables avec justification ;
- les impacts sur données, synchronisation, permissions, chiffrement, sauvegarde et migration sont traités ;
- les tests appropriés sont ajoutés et réussissent localement ;
- la CI de pull request réussit ;
- la documentation utilisateur et d'exploitation est mise à jour ;
- les changements de configuration et migrations sont documentés ;
- aucun secret ou contenu utilisateur n'apparaît dans les artefacts et journaux ;
- les exigences d'accessibilité pertinentes sont validées ;
- la revue est terminée ;
- `main` reste déployable.

Une version n'est publiable que si :

- toutes les fonctionnalités annoncées satisfont leur définition de terminé ;
- les images et artefacts sont reproductibles et identifiés ;
- une restauration de référence réussit ;
- les migrations prises en charge réussissent ;
- les vulnérabilités bloquantes sont corrigées ou explicitement acceptées avec justification ;
- les notes de version et instructions de mise à jour sont disponibles ;
- un retour à la version précédente est documenté et testé selon la stratégie annoncée.

---

## 45. Documentation obligatoire

La documentation doit couvrir au minimum :

- installation avec Compose ;
- configuration de `.env` et des secrets ;
- intégration derrière un reverse proxy externe ;
- création et conservation du kit de récupération ;
- sauvegarde, vérification et restauration ;
- mise à jour et retour arrière ;
- commandes administratives ;
- environnement de développement ;
- processus Git et CI ;
- publication et sélection des images ;
- formats d'export ;
- limites connues de sécurité et de suppression distante ;
- compatibilité des versions et migrations.

Les procédures critiques doivent être testées à partir d'une installation propre et ne doivent pas dépendre d'informations présentes uniquement dans l'historique des discussions.

---

## 46. Architecture évolutive

La première implémentation doit avancer par étapes, mais ne doit pas créer une fondation volontairement simpliste qui rendrait ensuite difficiles :

- synchronisation ;
- temporalité ;
- historique ;
- conflits ;
- fichiers ;
- graphe ;
- sauvegardes ;
- migrations ;
- stockage local partiel ;
- multiplateforme ;
- chiffrement et rotation des clés ;
- partage public ;
- permissions MCP.

Le modèle canonique, les identifiants, le versionnement et les frontières de sécurité doivent être conçus avant les fonctions qui en dépendent.

---

## 47. Découpage de livraison de référence

### Phase 0 — Fondations de livraison

1. environnement de développement reproductible ;
2. Compose initial et configuration validée ;
3. processus Git, CI et publication GHCR ;
4. observabilité minimale et documentation de démarrage.

### Phase 1 — Fondations du produit

5. modèle canonique des données ;
6. chiffrement, clés et kit de récupération ;
7. authentification mono-utilisateur ;
8. appareils et sessions.

### Phase 2 — Contenu utilisable

9. pages, dossiers et hiérarchie ;
10. navigation ;
11. éditeur par blocs ;
12. fichiers et pièces jointes ;
13. recherche initiale.

### Phase 3 — Local-first et sûreté des données

14. persistance locale chiffrée ;
15. fonctionnement hors ligne ;
16. synchronisation ;
17. historique et conflits ;
18. sauvegarde, restauration et export ;
19. mises à jour et retour arrière.

L'achèvement de cette phase constitue la V1 fonctionnelle, sous réserve de satisfaire tous les critères de qualité et d'exploitation.

### Phase 4 — Fonctions avancées

20. bases de données et tâches avancées ;
21. graphe ;
22. tableaux blancs ;
23. partage public et annotations ;
24. MCP.

### Phase 5 — Clients supplémentaires

25. application Electron Windows ;
26. application Electron macOS ;
27. adaptation iOS avancée ;
28. éventuelle application iOS native.

Chaque étape doit rester utilisable, testable et compatible avec la trajectoire globale. Une phase peut être divisée en plusieurs spécifications de fonctionnalité, mais aucune dépendance critique ne doit rester implicite.

---

## 48. Avertissement obligatoire du dépôt et des versions

Le README doit commencer par un avertissement très visible indiquant que le projet est produit en très grande partie par des intelligences artificielles.

Il doit prévenir que :

- le code peut contenir des erreurs ;
- les mécanismes de sécurité doivent être revus ;
- les migrations et restaurations doivent être testées ;
- des sauvegardes indépendantes sont indispensables ;
- le produit ne doit pas recevoir de données importantes sans validation humaine.

Les premières versions et leur documentation doivent reprendre cet avertissement tant qu'une validation humaine suffisante de la sécurité, des migrations et de la récupération n'a pas été formellement établie.

---

## 49. Paramètres initiaux et politique d'évolution

Les paramètres initiaux fixés par ce canevas sont :

- corbeille : 30 jours par défaut, configurable ;
- historique : 90 jours par défaut, configurable jusqu'à une conservation illimitée ;
- stockage local : 5 Go par défaut et par appareil, configurable ou illimité ;
- taille maximale d'un fichier : 2 Go par défaut, configurable ;
- sauvegarde automatique : quotidienne à 4 h dans le fuseau du serveur ;
- rétention des sauvegardes : trois mois par défaut, configurable ;
- alerte de sauvegarde : absence de sauvegarde vérifiée depuis plus de 26 heures ;
- restauration de test : au moins mensuelle en production et avant chaque version stable ;
- jeton MCP temporaire : dix minutes et usage unique ;
- accès MCP persistant : 90 jours par défaut, configurable ;
- session propriétaire : expiration après 30 jours d'inactivité par défaut, configurable de 1 à 90 jours ;
- authentification récente pour une opération sensible : moins de 15 minutes par défaut ;
- rotation planifiée de la clé d'enveloppement : au minimum annuelle et immédiatement après toute suspicion de compromission ;
- avertissements de stockage serveur : 80 % puis 90 % de capacité utilisée ;
- compatibilité client : version stable correspondante et version stable précédente lorsque le protocole le permet.

Les spécifications détaillées peuvent ajuster un paramètre avant son implémentation seulement si elles documentent :

- la raison du changement ;
- son impact sur les données, la sécurité et les performances ;
- la migration éventuelle ;
- les tests d'acceptation mis à jour.

Les niveaux de support détaillés des vues de bases de données et des futurs clients Electron ou iOS seront fixés dans leur spécification de phase, sans remettre en cause les invariants de ce document.

---

## 50. Critère de cohérence du document maître

Toute évolution de ce canevas doit :

- conserver le caractère strictement mono-utilisateur du produit ;
- identifier la version ou phase concernée ;
- éviter les adjectifs non mesurables sans critère associé ;
- distinguer une exigence produit d'un choix d'implémentation ;
- préciser les effets sur les données, le hors-ligne, la synchronisation, la sécurité, les migrations et les sauvegardes ;
- maintenir la cohérence entre le déploiement Compose, la CI, les images publiées et la documentation ;
- être relue avant de devenir la base d'une implémentation.

---

## Annexe A — Références de plateforme

- [MDN — StorageManager](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager)
- [WebKit — Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/)

Ces références expliquent des contraintes de stockage des navigateurs ; elles ne remplacent pas les exigences normatives de ce document.

---

## Annexe B — Clarifications validées le 10 août 2026

- Q : Le canevas distingue-t-il la cible complète et les versions livrables ? → R : Oui, document maître avec cible finale, V1 et versions suivantes.
- Q : Quel est le périmètre obligatoire de la V1 ? → R : Web responsive, Compose, authentification, pages/dossiers, éditeur, fichiers, recherche, hors-ligne, synchronisation, sauvegarde/restauration et export.
- Q : Le chiffrement applicatif au repos est-il obligatoire ? → R : Oui, sur le serveur et sur chaque appareil, avec une clé serveur externe aux données et une protection supplémentaire des volumes lorsque possible.
- Q : Comment récupérer les clés après une perte complète ? → R : Kit de récupération chiffré, conservable hors ligne, avec rotation et révocation.
- Q : Compose fournit-il le reverse proxy HTTPS ? → R : Non. L'application fonctionne localement en HTTP et un reverse proxy externe assure HTTPS et la publication.
