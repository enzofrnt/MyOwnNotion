# Research

- Decision : racines courantes par lecture existante sans saut de curseur.
  Rationale : le feed hydrate déjà les objets actuels, et la reprise reste intacte.
  Rejected : snapshot partiel au watermark ; snapshot existant monolithique et
  isolation par défaut insuffisante pour inventer une nouvelle frontière.
- Decision : couverture durable et publications après commit de lot.
  Rationale : un reload après interruption ne doit pas confondre absent et vide.
  Rejected : simplement supprimer await ; cela laisse routes, bases, onglets et
  pages avec enfants dans de faux états définitifs.
- Decision : racines complètes, sans nouvelle API metadata-only.
  Rationale : ouvrables immédiatement par le chemin éditorial actuel ; un corps
  absent nécessite une autre disponibilité contractuelle, hors besoin minimal.
- Decision : recherche paresseuse et fusion hiérarchique par lots.
  Rationale : notifications inutilisées déclenchent aujourd'hui l'index et une
  lecture ciblée relit tout le catalogue ; suppression de ce travail au démarrage.
- Decision : lire la couverture avant le catalogue et n'élaguer le contexte
  qu'après acceptation de ce catalogue, avec la même frontière pour la route
  initiale restaurée. Rationale : une notification indépendante peut lire le
  marqueur durable avant que la dernière lecture UI ait fini de déchiffrer.
- Decision : bases intégrées/natives sans entrée connue en chargement pendant
  la découverte ; bases déjà lisibles conservent leurs entrées connues, avec
  couverture partielle et notice sans total inventé.
  Rationale : l'absence de memberships ne prouve pas une base vide. À l'inverse,
  masquer des données déjà présentes bloquerait un ancien cache hors ligne
  sans marqueur, en contradiction avec FR003/US2.1.
- Decision : première recherche après une coupure finie des notifications.
  Rationale : attendre une période sans changements empêcherait de rechercher
  pendant un téléchargement continu. Les notifications ultérieures poursuivent
  normalement l'actualisation de l'index.
