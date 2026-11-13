# Tasks: renommage inline dans l'arbre

- [x] T001 Capturer l'état réel : le clic droit ouvre le menu, `Renommer`
      appelle `window.prompt`; aucune mutation n'est envoyée quand le
      navigateur supprime le dialogue.
- [x] T002 Extraire un champ de ligne `NavigationInlineRename` (focus +
      sélection, Entrée/Échap/blur, brouillon refusé conservé).
- [x] T003 Câbler le menu contextuel et `F2` sur ce champ, retirer
      `window.prompt`, router l'écriture par `renameSelectedItem`.
- [x] T004 Styler le champ dans le propriétaire existant (`navigation.css`) :
      hauteur de ligne respectée, pointeur grossier, thème clair/sombre.
- [x] T005 Tester le composant en jsdom (focus/sélection, Entrée, Échap, blur,
      vide/identique, refus, propagation du clic).
- [x] T006 Mettre à jour les journeys e2e (helper `renameItem`, `F2`) pour
      remplir le champ au lieu de répondre à un dialogue.
- [x] T007 Vérifier sur l'application réelle : ouverture, mutation acceptée,
      restauration, focus ligne, clair/sombre, 390 px.
- [x] T008 Ajouter E-064 au registre, consigner captures et commandes dans
      `validation.md`.
- [x] T009 Corriger l'enregistrement de la migration 0021 (bloquait la base
      neuve et le harness e2e) et ajouter le test statique du registre.
