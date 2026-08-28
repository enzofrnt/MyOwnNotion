export const UI_LOCALE = "fr-FR";

export const FR_COPY = {
  appName: "MyOwnNotion",
  actions: {
    add: "Ajouter",
    cancel: "Annuler",
    close: "Fermer",
    confirm: "Confirmer",
    continue: "Continuer",
    delete: "Supprimer",
    edit: "Modifier",
    more: "Plus d’actions",
    retry: "Réessayer",
    save: "Enregistrer",
    search: "Rechercher",
  },
  theme: {
    label: "Thème",
    system: "Système",
    light: "Clair",
    dark: "Sombre",
  },
  status: {
    loading: "Chargement…",
    empty: "Aucun contenu",
    unavailable: "Indisponible sur cet appareil",
    offline: "Hors ligne",
    error: "Une erreur est survenue",
    success: "Terminé",
    conflict: "Une décision est nécessaire",
    pending: "Enregistré sur cet appareil",
    syncing: "Synchronisation…",
    info: "Information",
  },
  synchronization: {
    workspaceLabel: "Synchronisation de l’espace de travail",
    offline: "Enregistré sur cet appareil — synchronisation à la reconnexion",
    pending: "Enregistré sur cet appareil — changements en attente de synchronisation",
    syncing: "Synchronisation…",
    synced: "Synchronisé",
    attention: "Une intervention est nécessaire — toutes les versions sont conservées",
    localSaveFailed:
      "Non enregistré — le stockage local est indisponible ou plein ; la dernière modification a été refusée",
    storageNotPersistent:
      "Protection locale non garantie par ce navigateur — consultez Stockage et synchronisation.",
    oldDraftSingular: "ancien brouillon à récupérer",
    oldDraftPlural: "anciens brouillons à récupérer",
    decisionSingular: "décision",
    decisionPlural: "décisions",
    pendingSingular: "changement à synchroniser",
    pendingPlural: "changements à synchroniser",
    filePendingSingular: "fichier à transférer",
    filePendingPlural: "fichiers à transférer",
    compact: {
      localSaved: "Enregistré sur cet appareil",
      syncing: "Synchronisation…",
      synced: "Synchronisé",
      attention: "Intervention nécessaire",
      notSaved: "Non enregistré",
      storageNotPersistent: "Stockage local non garanti",
    },
    quotaWarning: (percentage: number) =>
      `Le stockage local est rempli à ${percentage} % — l’enregistrement pourrait bientôt échouer.`,
    realtime: {
      connecting: "Connexion aux mises à jour en direct…",
      live: "En direct — les changements de vos autres appareils apparaissent ici",
      local: "Les changements restent sur cet appareil jusqu’au retour de la connexion",
      revoked: "L’accès de cet appareil a été révoqué. Il ne peut plus se synchroniser.",
      needsUpdate:
        "Cette application doit être mise à jour avant que cet appareil puisse se synchroniser.",
      revokedRefusal: "Reconnectez-vous ou autorisez de nouveau cet appareil.",
      updateRefusal: "Mettez l’application à jour, puis rechargez cette page.",
      compactConnecting: "Connexion en direct…",
      compactLive: "Mises à jour en direct",
      compactLocal: "Mises à jour en pause",
      compactRevoked: "Accès révoqué",
      compactNeedsUpdate: "Mise à jour requise",
    },
  },
  navigation: {
    trashTitle: "Placer cet élément dans la corbeille ?",
    trashDescription: (name: string) =>
      `« ${name} » sera placé dans la corbeille et pourra être restauré depuis les réglages.`,
    trashConfirm: "Placer dans la corbeille",
  },
  connection: {
    label: "Connexion",
    connectedTo: "Connecté à",
    checking: "Vérification de la disponibilité du serveur…",
    reachable: "Le serveur est disponible.",
    unreachable:
      "Le serveur n’est pas disponible. Votre travail reste sur cet appareil jusqu’au retour de la connexion.",
    insecureTitle: "Cette connexion n’est pas sécurisée.",
    insecureDescription:
      "Cette adresse HTTP ne désigne pas cet appareil : les données échangées pourraient être lues ou modifiées sur le réseau. Placez le serveur derrière HTTPS avant d’y conserver de vraies notes.",
    versionMismatchTitle: "Versions incompatibles",
    versionMismatch: (serverVersion: number | string, clientVersion: number) =>
      `Le serveur utilise la version de schéma ${serverVersion}, tandis que cette application attend la version ${clientVersion}. Mettez à jour le composant le plus ancien avant de continuer.`,
  },
  auth: {
    bootstrap: {
      title: "Configurer cette installation",
      owners: "Propriétaires",
      workspaces: "Espaces de travail",
      checking: "Vérification de l’installation…",
      unavailableTitle: "Installation indisponible",
      unavailable: "L’installation ne répond pas. Aucune modification n’a été effectuée.",
      unavailableServer: "L’installation ne répond pas. Vérifiez que le serveur est démarré.",
      createTitle: "Créer la passkey du propriétaire",
      createDescription:
        "Cette installation n’a pas encore de propriétaire. La création de la passkey et l’enregistrement du kit de récupération prennent environ une minute et doivent être terminés sans recharger la page.",
      createAction: "Créer la passkey",
      verifying: "Confirmation de la passkey par votre appareil…",
      anotherBrowser:
        "Un autre navigateur configure déjà cette installation. Terminez la configuration dans ce navigateur, puis rechargez cette page.",
      startFailed: "La configuration n’a pas démarré. Rechargez la page et réessayez.",
      passkeyRejected: "La passkey n’a pas été acceptée. Recommencez pour obtenir un nouveau défi.",
      continueFailed: "La configuration ne peut pas continuer. Recommencez.",
      downloadConsumed:
        "Ce téléchargement a déjà été utilisé. Générez un nouveau kit pour le télécharger.",
      downloadFailed: "Le kit n’a pas pu être téléchargé. Générez-en un nouveau et réessayez.",
      regenerateFailed:
        "Un nouveau kit n’a pas pu être généré. Rechargez la page pour recommencer.",
      regenerated: "Un nouveau kit est prêt. Le précédent n’est plus valable.",
      completionFailed:
        "La configuration n’a pas pu être terminée. L’installation n’a toujours pas de propriétaire.",
    },
    passkey: {
      unsupported:
        "Ce navigateur ne peut pas créer de passkey. Utilisez une version récente de Firefox, Chrome ou Safari.",
      cancelled:
        "La demande de passkey a été fermée avant la fin. Relancez-la lorsque vous êtes prêt.",
      alreadyRegistered: "Cet appareil possède déjà une passkey pour cette installation.",
      insecureContext:
        "Les passkeys exigent une connexion sécurisée. Ouvrez l’installation en HTTPS ou via localhost.",
      failed: "La passkey n’a pas pu être créée. Réessayez.",
      ownerName: "Propriétaire",
    },
    login: {
      title: "Se connecter",
      refused: "La connexion a échoué. Vérifiez votre passkey ou votre mot de passe et réessayez.",
      rateLimited: "Trop de tentatives. Attendez quelques minutes avant de réessayer.",
      waiting: "Confirmation par votre appareil…",
      passkeyTitle: "Utiliser votre passkey",
      passkeyDescription: "Votre appareil va vous demander de confirmer.",
      passkeyAction: "Se connecter avec une passkey",
      usePassword: "Utiliser le mot de passe",
      passwordTitle: "Utiliser votre mot de passe",
      passwordLabel: "Mot de passe",
      passwordAction: "Se connecter",
      usePasskey: "Utiliser la passkey",
      passwordOnly:
        "Ce navigateur ne peut pas utiliser les passkeys. Connectez-vous avec votre mot de passe.",
    },
  },
  search: {
    title: "Rechercher dans l’espace de travail",
    dialogLabel: "Recherche dans l’espace de travail",
    queryLabel: "Recherche",
    queryHint: "Recherchez dans les titres, le contenu des pages, les dossiers et les fichiers.",
    action: "Rechercher",
    close: "Fermer la recherche",
    typeFilter: "Filtrer par type",
    branch: "Emplacement",
    wholeWorkspace: "Tout l’espace de travail",
    resetFilters: "Réinitialiser les filtres",
    pages: "Pages",
    folders: "Dossiers",
    files: "Fichiers",
    resultsLabel: "Résultats de recherche",
    loading: "Recherche dans tout l’espace de travail…",
    loadingComplete: "Résultats locaux affichés. Recherche complète en cours…",
    offline: "Hors ligne — la recherche est limitée aux données disponibles sur cet appareil.",
    rebuilding:
      "L’index complet est en reconstruction. Les résultats locaux fiables restent disponibles.",
    degraded:
      "La recherche complète est temporairement indisponible. Les résultats locaux fiables restent visibles.",
    refreshed:
      "Le contenu a changé pendant le chargement. Les résultats ont été actualisés depuis le début.",
    noLocalResult: "Aucun résultat dans les données disponibles sur cet appareil.",
    noResult: "Aucun résultat dans l’espace de travail.",
    unavailable:
      "La recherche complète est temporairement indisponible. Votre saisie reste modifiable.",
    queryTooLong: "La recherche est limitée à 512 caractères Unicode.",
    loadMore: "Afficher plus de résultats",
    loadingMore: "Chargement de résultats supplémentaires…",
    matchedProperty: "Propriété correspondante",
    released: "Contenu retiré de cet appareil",
    notDownloaded: "Contenu non téléchargé sur cet appareil",
    unresolvedConflict: "Décision en attente",
    completeCoverage: "tout l’espace de travail",
    localCoverage: "les données de cet appareil",
    contentRefreshed: "Le contenu a changé ; les résultats ont été actualisés.",
    selected: "Sélection",
    resultSingular: "résultat",
    resultPlural: "résultats",
  },
  files: {
    preview: {
      loadFailed: "Ce fichier n’a pas pu être chargé.",
      loadFailedHere: "Ce fichier n’a pas pu être chargé sur cet appareil.",
      remoteOnlyFailed:
        "Ce fichier n’est pas présent sur cet appareil et n’a pas pu être récupéré. Il reste conservé sur le serveur ; réessayez lorsque la connexion sera disponible.",
      loading: "Chargement du fichier…",
      offlineRemoteOnly:
        "Ce fichier n’est pas présent sur cet appareil et aucune connexion ne permet de le récupérer. Il reste conservé sur le serveur.",
      fetchingReleased:
        "Récupération du fichier — cet appareil l’avait retiré pour respecter sa limite de stockage.",
      fetchingFirst: "Première récupération de ce fichier sur cet appareil…",
      frameTitle: "Aperçu du fichier",
      about: "Informations sur le fichier",
      unsupported:
        "Ce type de fichier ne peut pas être prévisualisé ici. Téléchargez-le pour l’ouvrir avec l’application habituelle.",
      download: "Télécharger le fichier",
    },
    storage: {
      label: "Stockage de cet appareil",
      loading: "Mesure du stockage local…",
      title: "Cet appareil",
      used: "utilisés",
      noLimitSet: "aucune limite définie",
      ofLimit: "sur",
      durable: "Ce navigateur a accepté de conserver vos données locales.",
      notDurable:
        "Ce navigateur ne garantit pas la conservation des données locales. Des changements non synchronisés pourraient être effacés en cas de manque d’espace.",
      requestDurability: "Demander la conservation locale",
      breakdown: "Répartition du stockage",
      limit: "Limite sur cet appareil",
      unlimited: "Sans limite",
      explanation:
        "Lorsque la limite est atteinte, cet appareil retire d’abord les contenus les plus anciens et volumineux que le serveur peut restituer. Les changements non envoyés, les décisions en attente et les contenus gardés hors ligne ne sont jamais retirés.",
    },
    transfer: {
      ready: "Prêt",
      sending: "Envoi…",
      of: "sur",
      verifying: "Vérification…",
      verifyingDetail:
        "Tous les octets sont arrivés. Le serveur vérifie maintenant leur intégrité.",
      stored: "Stocké",
      blocked: "Non stocké",
      blockedDetail: "Le transfert s’est arrêté. Le fichier reste disponible sur cet appareil.",
      limitDetail: "Cette installation accepte des fichiers jusqu’à",
    },
    attachments: {
      label: "Pièces jointes de la page",
      title: "Pièces jointes",
      loadFailed:
        "Les pièces jointes n’ont pas pu être actualisées. Les fichiers déjà enregistrés restent conservés.",
      add: "Ajouter un fichier à cette page",
      remove: "Retirer ce fichier de la page",
      removeAction: "Retirer",
      preview: "Prévisualiser le fichier",
      previewAction: "Aperçu",
      closePreview: "Fermer l’aperçu",
      location: "cette page",
      empty: "Aucune pièce jointe. Les fichiers ajoutés ici restent rattachés à cette page.",
      onDevice: "Sur cet appareil",
      onDeviceDetail: "Disponible sans connexion.",
      offloaded: "Non présent sur cet appareil",
      offloadedDetail:
        "Retiré pour respecter la limite de stockage. Son ouverture le récupérera à nouveau.",
      neverFetched: "Pas encore récupéré",
      neverFetchedDetail: "Conservé sur le serveur. Son ouverture le téléchargera ici.",
      fileKind: "fichier",
      unknownType: "type inconnu",
      addedUnknown: "date d’ajout inconnue",
      added: "ajouté le",
      inLocation: "dans",
      synchronized: "Synchronisé",
      notSynchronized: "Pas encore synchronisé",
      usedNowhereElse: "aucune autre utilisation",
      usedIn: "utilisé dans",
    },
    deletion: {
      action: "Supprimer le fichier",
      checking: "Vérification des utilisations…",
      checkFailed:
        "Les utilisations de ce fichier n’ont pas pu être vérifiées. Le fichier n’a pas été supprimé.",
      deleteFailed:
        "Le fichier n’a pas pu être supprimé. Il reste conservé avec toutes ses utilisations.",
      title: "Supprimer ce fichier ?",
      description:
        "Le fichier sera placé dans la corbeille et pourra être restauré pendant 30 jours.",
      keep: "Conserver le fichier",
      confirm: "Supprimer quand même",
      usages: "Pages et blocs qui utilisent ce fichier",
      usageSingular: "utilisation connue",
      usagePlural: "utilisations connues",
    },
    replacement: {
      label: "Remplacer le contenu",
      stale:
        "Le fichier a été modifié sur un autre appareil. Rechargez les informations avant de réessayer.",
      failed:
        "Le contenu n’a pas pu être remplacé. La version actuelle du fichier reste conservée.",
      done: "Contenu remplacé — toutes les occurrences de ce fichier affichent la nouvelle version.",
    },
  },
  backup: {
    title: "Sauvegardes",
    never: "jamais",
    loading: "Vérification de la dernière sauvegarde de l’espace de travail…",
    loadFailed:
      "L’état des sauvegardes n’a pas pu être chargé. Réessayez lorsque le serveur sera disponible.",
    creationFailedTitle: "La dernière sauvegarde a échoué à la vérification locale.",
    creationFailed:
      "Elle n’a pas été envoyée vers la destination. Vérifiez la configuration avant de relancer une sauvegarde.",
    transferFailedTitle: "La dernière sauvegarde n’a pas été vérifiée après son transfert.",
    transferFailed:
      "La copie locale est valide, mais aucune copie vérifiée n’a été confirmée à destination.",
    staleTitle: "Aucune sauvegarde vérifiée depuis plus d’une journée.",
    stale: "Cet espace de travail n’est actuellement pas protégé contre la perte de cette machine.",
    lastVerified: "Dernière sauvegarde vérifiée",
    rehearsalTitle: "Test de restauration",
    lastRehearsal: "Dernier test de restauration",
    succeeded: "réussi",
    failed: "échoué",
    rehearsalDue:
      "Le dernier test de restauration date de plus d’un mois. Le test utilise un emplacement séparé et ne modifie pas cet espace de travail.",
    runRehearsal: "Tester une restauration",
    runningRehearsal: "Test de restauration…",
    rehearsalSucceeded:
      "La sauvegarde a été restaurée avec succès dans un environnement isolé. Cet espace de travail n’a pas été modifié.",
    rehearsalFailed:
      "Le test de restauration n’a pas abouti. Cet espace de travail n’a pas été modifié.",
  },
  history: {
    title: "Historique",
    label: "Historique des révisions",
    currentHead: "Révision actuelle",
    retention: "Les contenus remplacés restent restaurables pendant 24 heures.",
    revisionId: "Identifiant de la révision",
    revisionPlaceholder: "UUID de la révision",
    invalidId: "Saisissez un UUID de révision valide.",
    preview: "Prévisualiser",
    expired:
      "Le contenu de cette révision n’est plus conservé après 24 heures, mais sa filiation reste dans l’historique.",
    loadFailed: "Cette révision n’a pas pu être chargée.",
    stale:
      "La version actuelle a changé depuis la préparation de cette restauration. Rechargez l’historique puis recommencez.",
    restoreFailed: "La révision n’a pas pu être restaurée. La version actuelle reste inchangée.",
    restored:
      "Le contenu a été restauré dans une nouvelle révision. L’historique existant reste inchangé.",
    changed: "Modification",
    on: "le",
    from: "depuis",
    removedDevice: "un appareil supprimé",
    unrecordedDevice: "un appareil non identifié",
    parents: "Révisions parentes",
    noParent: "aucune — création",
    joined: "Cette révision réunit deux versions ; les deux restent accessibles dans l’historique.",
    snapshot: "Contenu conservé",
    restore: "Restaurer dans une nouvelle révision",
  },
  security: {
    title: "Sécurité",
    recentAuthentication:
      "Confirmez de nouveau votre passkey ou votre mot de passe, puis réessayez.",
    passkeys: {
      title: "Passkeys",
      loading: "Chargement des passkeys…",
      loadFailed: "Les passkeys n’ont pas pu être chargées.",
      remove: "Retirer",
      onlyOne:
        "Il s’agit de votre seule passkey. Ajoutez-en une autre ou définissez un mot de passe avant de la retirer.",
      removeOnly:
        "Il s’agit de votre seul moyen de connexion. Ajoutez une autre passkey ou définissez d’abord un mot de passe.",
      removeFailed: "Cette passkey n’a pas pu être retirée.",
    },
    password: {
      title: "Mot de passe",
      description:
        "Une solution de secours lorsque votre passkey n’est pas disponible. Votre passkey continuera de fonctionner.",
      warning:
        "Il n’existe aucune réinitialisation du mot de passe. Si vous l’oubliez, utilisez votre passkey ou votre kit de récupération.",
      label: "Nouveau mot de passe",
      save: "Enregistrer le mot de passe",
      saved: "Mot de passe enregistré.",
      validation:
        "Utilisez au moins 12 caractères, par exemple quelques mots sans rapport entre eux.",
      failed: "Le mot de passe n’a pas pu être enregistré.",
    },
    devices: {
      title: "Vos appareils",
      loading: "Chargement des appareils autorisés…",
      empty: "Aucun appareil autorisé.",
      loadFailed: "La liste des appareils n’a pas pu être chargée.",
      nameRequired: "Un appareil doit avoir un nom.",
      renameFailed: "Cet appareil n’a pas pu être renommé.",
      revokeFailed: "Cet appareil n’a pas pu être révoqué.",
      reauthorizeFailed: "Cet appareil n’a pas pu être invité à se reconnecter.",
      reauthorizeScheduled: "Cet appareil devra se reconnecter.",
      revokedNotice:
        "Cet appareil ne peut plus accéder à cet espace de travail. Les données déjà enregistrées dessus ne peuvent pas être effacées à distance s’il ne se reconnecte jamais.",
      current: "cet appareil",
      name: "Nom de l’appareil",
      saveName: "Enregistrer",
      cancelRename: "Annuler",
      rename: "Renommer",
      reauthorize: "Demander une nouvelle connexion",
      revoke: "Révoquer",
      revokeTitle: "Une confirmation avec votre passkey ou votre mot de passe sera demandée",
      revokeDialogTitle: (name: string) => `Révoquer « ${name} » ?`,
      revokeDialogDescription:
        "Cet appareil perdra immédiatement son accès. Une confirmation récente avec votre passkey ou votre mot de passe peut être demandée.",
      revokeDialogConfirm: "Révoquer l’appareil",
      lastUsed: "dernière utilisation",
      lastSynchronized: "dernière synchronisation",
      never: "jamais",
      unknown: "inconnue",
      states: {
        revoked: "Révoqué",
        reauthorizationRequired: "Nouvelle connexion nécessaire",
        pending: "Pas encore confirmé",
        active: "Actif",
      },
    },
    sessions: {
      title: "Vos connexions",
      loading: "Chargement des connexions…",
      empty: "Aucune connexion enregistrée.",
      loadFailed: "La liste des connexions n’a pas pu être chargée.",
      revokeFailed: "Cette connexion n’a pas pu être fermée.",
      revokeOthersAuthentication:
        "Confirmez de nouveau votre passkey ou votre mot de passe avant de fermer les autres connexions.",
      revokeOthersFailed: "Les autres connexions n’ont pas pu être fermées.",
      revokeOthersDone: "Toutes les autres connexions ont été fermées.",
      passkey: "Passkey",
      password: "Mot de passe",
      current: "ce navigateur",
      lastSeen: "Dernière activité",
      started: "connexion commencée",
      states: {
        active: "active",
        revoked: "révoquée",
        expired: "expirée",
      },
      signOutHere: "Se déconnecter ici",
      signOut: "Déconnecter",
      signOutOthers: "Déconnecter tous les autres appareils",
    },
    recoveryKit: {
      title: "Enregistrer votre kit de récupération",
      introduction:
        "Il s’agit de l’unique copie. Téléchargez-la puis conservez-la hors ligne, par exemple sur un support chiffré distinct de cet appareil.",
      deploymentKeyRequirement:
        "Sauvegardez également le fichier de clé de déploiement dans un autre emplacement. Il déverrouille ce kit ; le kit seul ne permet aucune restauration.",
      kit: "Kit",
      downloadExpires: "Téléchargement disponible jusqu’à",
      soon: "bientôt",
      downloaded: "Téléchargé",
      download: "Télécharger le kit de récupération",
      regenerate: "Générer un nouveau kit",
      consumed:
        "Ce téléchargement a été utilisé. Si le fichier n’a pas été enregistré, générez un nouveau kit ; l’ancien cessera alors de fonctionner.",
      oneDownload:
        "Ce kit peut être téléchargé une seule fois. La génération d’un nouveau kit invalide celui-ci.",
      acknowledge:
        "J’ai conservé ce kit et une copie de la clé de déploiement hors ligne, dans un emplacement accessible sans cet appareil.",
      finish: "Terminer la configuration",
    },
    recovery: {
      title: "Récupération du compte",
      unknown:
        "L’état de la récupération n’a pas pu être chargé. Impossible de confirmer si cette installation est récupérable.",
      missing:
        "Vous n’avez aucun kit de récupération. Si vous perdez votre passkey et cette machine, vous ne pourrez plus accéder à cet espace de travail.",
      replacementPending:
        "Vous disposez d’un kit utilisable et son remplacement est en cours. L’ancien reste valable jusqu’à la confirmation du nouveau.",
      ready: "Vous disposez d’un kit de récupération.",
      keyRequirement:
        "Le kit est déverrouillé par le fichier de clé de déploiement de cette installation. Conservez-en une copie séparément : le kit seul ne permet aucune restauration.",
      kit: "Kit",
      confirmed: "Confirmé",
      notYet: "pas encore",
      generate: "Générer un nouveau kit de récupération",
      replacementSafety:
        "Votre kit actuel reste valable jusqu’au téléchargement du nouveau et à la confirmation de sa conservation.",
      prepared: "Un nouveau kit est prêt à être téléchargé.",
      prepareFailed: "Le nouveau kit n’a pas pu être préparé. Votre kit actuel reste valable.",
    },
    rotation: {
      title: "Clés de chiffrement",
      writesPaused:
        "Les nouvelles modifications sont suspendues jusqu’à la rotation d’une clé. Tout votre contenu reste lisible.",
      installationKey: "Clé de l’installation",
      noteKey: "Clé des notes",
      installationKeyDescription:
        "Cette clé protège les clés de l’installation. Sa rotation est rapide et ne modifie pas vos notes.",
      noteKeyDescription:
        "Cette clé protège vos notes. Sa rotation réécrit chaque contenu et peut prendre du temps.",
      status: {
        inProgress:
          "Une rotation est en cours. Vos notes restent lisibles pendant toute l’opération.",
        failed:
          "La dernière rotation n’a pas abouti. Rien n’a été perdu et vos notes restent lisibles ; relancez l’opération.",
        writeBlock:
          "Cette clé est en retard : les nouvelles modifications sont suspendues. Tout reste lisible et la rotation rétablit l’enregistrement.",
        emergency:
          "Cette clé a été signalée comme urgente. Lancez sa rotation maintenant ; l’enregistrement sera suspendu dès l’échéance.",
        overdueUnknown:
          "Cette clé est en retard. L’enregistrement sera bientôt suspendu si elle n’est pas renouvelée.",
        overdue: "Cette clé est en retard. L’enregistrement sera suspendu dans",
        day: "jour",
        days: "jours",
        due: "Cette clé doit être renouvelée.",
        complete: "Rotation terminée. Aucune action nécessaire.",
        current: "À jour.",
      },
      progressStarting: "Démarrage.",
      progressOf: "sur",
      notes: "notes",
      workspaces: "espaces de travail",
      nextStep: "Étape suivante",
      actions: {
        none: "aucune action",
        schedule: "planifier la rotation",
        start: "lancer la rotation",
        urgent: "lancer la rotation immédiatement",
        resume: "reprendre la rotation",
        retry: "relancer la rotation",
      },
      hostInstructions:
        "La rotation s’effectue sur la machine qui héberge cette installation avec la commande",
      hostReason:
        "Cette action n’est pas proposée ici, car elle nécessite le fichier de clé accessible uniquement depuis l’hôte.",
    },
  },
  field: {
    optional: "facultatif",
    required: "obligatoire",
  },
  editor: {
    surface: {
      label: "Éditeur de page",
      contentLabel: "Contenu de la page",
      loading: "Chargement de cette page…",
      offlineUnavailable:
        "Cette page ne peut pas être ouverte hors ligne sur un appareil qui ne peut pas enregistrer localement.",
      unavailable: "Cette page n’a pas pu être ouverte en toute sécurité.",
      unavailableWithDetail: (detail: string) =>
        `Cette page n’a pas pu être ouverte en toute sécurité : ${detail}`,
      historyLabel: "Historique local",
      undo: "Annuler",
      undoTitle: "Annuler (⌘Z)",
      redo: "Rétablir",
      redoTitle: "Rétablir (⇧⌘Z)",
    },
    slashMenu: {
      advancedGroup: "Blocs avancés",
      navigationGroup: "Navigation",
      toggle: {
        title: "Liste dépliable",
        description: "Masquer ou afficher des blocs imbriqués",
      },
      callout: {
        title: "Encadré",
        description: "Mettre une information en évidence",
      },
      table: {
        title: "Tableau simple",
        description: "Créer un tableau à identités stables",
      },
      embed: {
        title: "Contenu intégré",
        description: "Ajouter explicitement un aperçu tiers avec votre accord",
      },
      link: {
        title: "Lien",
        description: "Créer un lien vers une page ou une adresse Web",
      },
      subpage: {
        title: "Sous-page",
        description: "Créer une page imbriquée et insérer son lien",
        defaultTitle: "Sans titre",
        creationFailed: "La sous-page n’a pas pu être créée.",
      },
    },
    blocks: {
      paragraph: "Texte",
      heading1: "Titre 1",
      heading2: "Titre 2",
      heading3: "Titre 3",
      bulletListItem: "Liste à puces",
      numberedListItem: "Liste numérotée",
      checkListItem: "Tâche",
      quote: "Citation",
      codeBlock: "Code",
      divider: "Séparateur",
      toggleListItem: "Section repliable",
      callout: "Encadré",
      table: "Tableau",
      image: "Image",
      fileEmbed: "Fichier",
      embed: "Contenu intégré",
    },
    errors: {
      notApplied: "Cette modification n’a pas été appliquée.",
      notAppliedWithDetail: (detail: string) =>
        `Cette modification n’a pas été appliquée : ${detail}`,
      remoteUpdateFailed: "La mise à jour distante n’a pas pu être appliquée.",
      remoteUpdateFailedWithDetail: (detail: string) =>
        `La mise à jour distante n’a pas pu être appliquée : ${detail}`,
      historyFailed: "L’historique local n’a pas pu être appliqué.",
      historyActionFailed: (action: "undo" | "redo", detail: string) =>
        `${action === "undo" ? "Impossible de revenir en arrière" : "Impossible de rétablir"} : ${detail}`,
      fileInsertionFailed: "Ce fichier n’a pas pu être inséré.",
      fileInsertionFailedWithDetail: (detail: string) =>
        `Ce fichier n’a pas pu être inséré : ${detail}`,
      projectionDrift:
        "L’affichage ne correspondait plus au contenu enregistré ; il a été réaligné.",
      unknownTransform:
        "Un bloc non pris en charge ne peut pas être transformé sans risquer de perdre son contenu.",
      moveRefused: "Ce déplacement est refusé : la destination n’accepte pas ce bloc.",
      undoFailed: "Impossible de revenir en arrière",
      redoFailed: "Impossible de rétablir",
    },
    files: {
      localOnly: "Enregistré localement — transfert en attente",
      transferring: "Transfert en cours",
      verifying: "Vérification du serveur…",
      synchronized: "Octets vérifiés sur le serveur",
      blockedNetwork: "Transfert en attente du réseau.",
      loading: "Recherche du fichier…",
      unavailable:
        "Ce fichier n’est disponible ni sur cet appareil ni depuis le serveur pour le moment.",
      offlineUnavailable:
        "Ce fichier n’est pas présent sur cet appareil. Reconnectez-vous pour le récupérer.",
      download: "Télécharger",
      integratedFile: "Fichier intégré",
      displayedName: "Nom affiché du fichier",
      imageCaption: "Légende de l’image",
      imageAltText: "Texte alternatif de l’image",
      imageLoading: "Chargement de l’image…",
      imageUnavailable: "L’image ne peut pas être affichée sur cet appareil pour le moment.",
    },
    richBlocks: {
      toggle: {
        expand: "Déplier cette section",
        collapse: "Replier cette section",
        addChild: "Ajouter un bloc dans cette section",
      },
      callout: {
        label: "Encadré",
        icon: "Icône de l’encadré",
        tone: "Couleur de l’encadré",
        tones: {
          default: "Neutre",
          gray: "Gris",
          brown: "Marron",
          orange: "Orange",
          yellow: "Jaune",
          green: "Vert",
          blue: "Bleu",
          purple: "Violet",
          pink: "Rose",
          red: "Rouge",
        },
      },
      code: {
        label: "Bloc de code",
        language: "Langage du code",
        plainText: "Texte brut",
        copy: "Copier",
        copied: "Code copié.",
        copyFailed: "Impossible de copier le code.",
      },
      table: {
        actions: "Actions du tableau",
        name: "Tableau",
        row: "ligne",
        rows: "lignes",
        column: "colonne",
        columns: "colonnes",
        addRow: "Ajouter une ligne",
        addColumn: "Ajouter une colonne",
        removeLastRow: "Retirer la dernière ligne",
        removeLastColumn: "Retirer la dernière colonne",
        cell: "Cellule du tableau",
      },
      embed: {
        source: "Adresse du contenu intégré",
        provider: "Fournisseur du contenu intégré",
        caption: "Légende du contenu intégré",
        openSource: "Ouvrir la source",
        unsafe: "Cette adresse n’est pas autorisée pour ce fournisseur.",
        staticPreview: "Aperçu statique — aucune communication avec le site tiers.",
        consent: "Charger le contenu tiers",
      },
    },
    pageLinks: {
      deleted: "cible supprimée",
      unavailable: "cible indisponible",
      unknown: "cible inconnue",
    },
  },
  date: {
    invalid: "Date invalide",
  },
} as const;

export type ShortcutPlatform = "mac" | "windows" | "linux";
export type ShortcutKey =
  | "mod"
  | "shift"
  | "alt"
  | "enter"
  | "escape"
  | "space"
  | "arrowUp"
  | "arrowDown"
  | "arrowLeft"
  | "arrowRight"
  | string;

export const APP_SHORTCUTS = {
  search: ["mod", "k"],
  close: ["escape"],
  submit: ["mod", "enter"],
  commandMenu: ["/"],
} as const satisfies Record<string, readonly ShortcutKey[]>;

const MAC_KEYS: Readonly<Record<string, string>> = {
  mod: "⌘",
  shift: "⇧",
  alt: "⌥",
  enter: "↵",
  escape: "Échap",
  space: "Espace",
  arrowUp: "↑",
  arrowDown: "↓",
  arrowLeft: "←",
  arrowRight: "→",
};

const OTHER_KEYS: Readonly<Record<string, string>> = {
  mod: "Ctrl",
  shift: "Maj",
  alt: "Alt",
  enter: "Entrée",
  escape: "Échap",
  space: "Espace",
  arrowUp: "↑",
  arrowDown: "↓",
  arrowLeft: "←",
  arrowRight: "→",
};

function displayShortcutKey(key: ShortcutKey, platform: ShortcutPlatform): string {
  const labels = platform === "mac" ? MAC_KEYS : OTHER_KEYS;
  return labels[key] ?? key.toLocaleUpperCase(UI_LOCALE);
}

export function formatShortcut(keys: readonly ShortcutKey[], platform: ShortcutPlatform): string {
  const separator = platform === "mac" ? " " : " + ";
  return keys.map((key) => displayShortcutKey(key, platform)).join(separator);
}

export function formatNumber(value: number | bigint, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(UI_LOCALE, options).format(value);
}

export type DateInput = Date | number | string;

function asDate(value: DateInput): Date {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    if (year !== undefined && month !== undefined && day !== undefined) {
      return new Date(year, month - 1, day);
    }
  }
  return value instanceof Date ? value : new Date(value);
}

export function formatDate(
  value: DateInput,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
): string {
  const date = asDate(value);
  if (Number.isNaN(date.getTime())) {
    return FR_COPY.date.invalid;
  }
  return new Intl.DateTimeFormat(UI_LOCALE, options).format(date);
}

export function formatDateTime(
  value: DateInput,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
): string {
  return formatDate(value, options);
}
