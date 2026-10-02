# Contrat de styles

Nouveau code : --ui-* et composants exportés par ui/primitives/index.ts.
Les aliases du contrat 017 et anciens aliases demeurent compatibles.
Un domaine possède son CSS ; les primitives possèdent leurs états visuels.
Une variante commune s’ajoute à la primitive, un layout propre reste dans le domaine.
L’apparence d’un contrôle natif historique ne doit pas atteindre une primitive
ou un contrôle d’éditeur tiers. Les adaptations BlockNote ont leur propriétaire
et leurs exceptions explicites. Données utilisateur et API ne changent pas.

La prop UiLab.overlay explicite demeure déterministe pour les snapshots ; sans
cette prop, les déclencheurs doivent ouvrir réellement les surfaces contextuelles.

Status garde un fond transparent et le texte principal ; le focus des contrôles
communs est neutre sans halo. Danger garde texte/contour rouges sur fond neutre,
le menu ne prend cet accent qu’à l’interaction. AsyncState loading fournit un
Skeleton décoratif et conserve l’annonce d’attente ; adapter le cadre et le
nombre de rangées dans la composition qui connaît le contenu.
