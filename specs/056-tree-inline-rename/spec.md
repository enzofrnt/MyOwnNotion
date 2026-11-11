# Feature Specification: Renommage inline dans l'arbre

**Feature**: `056-tree-inline-rename`
**Statut**: implémenté
**Registre**: corrige `E-064` de `specs/054-ui-parity-errors/errors.md`

## Besoin

Le propriétaire signale qu'il « n'arrive plus à renommer un élément » depuis la
barre latérale : le clic droit sur une ligne, puis « Renommer », ne produit
rien, en largeur mobile comme en largeur bureau.

Le renommage passait par `window.prompt`. Un navigateur peut supprimer
silencieusement les dialogues (`prompt()` renvoie alors `null` immédiatement :
case « Empêcher cette page de créer d'autres dialogues », politiques
d'entreprise, environnements intégrés). L'application ne recevait alors aucune
saisie et n'affichait aucune erreur : le geste semblait simplement inopérant.
Le dialogue natif était de toute façon hors parité : il masque l'élément
renommé, ne se traduit pas, ne se thème pas et ne suit pas le parcours des
autres champs inline de l'application.

## Portée

- Le menu contextuel de ligne (« Renommer »), la touche `F2` et le futur
  raccourci du même intent ouvrent **le champ de la ligne elle-même**.
- Le champ est prérempli avec le nom courant, focalisé et intégralement
  sélectionné.
- `Entrée` valide, `Échap` restaure le nom précédent, un clic hors du champ
  valide comme dans Notion. Un brouillon vide ou inchangé se ferme sans
  écriture.
- Le nom est écrit par la même voie que le titre de page : relecture de la
  révision courante, reprise sur `revision.stale-base`, et propagation au nom
  de source d'une base de données.
- Un refus serveur (révision périmée, hors ligne) conserve le brouillon et le
  champ ouvert pour une reprise immédiate ; le problème reste affiché par le
  bandeau existant.
- Aucun dialogue natif ne subsiste pour renommer.

## Hors portée

- Renommer depuis l'en-tête de page, le tableau ou une carte : déjà couvert et
  inchangé.
- Glisser-déposer, déplacement, conversion : inchangés.

## Critères d'acceptation

1. Clic droit sur une ligne de l'arbre → « Renommer » affiche un champ dans la
   ligne, sans dialogue navigateur.
2. `F2` sur la ligne sélectionnée ouvre le même champ.
3. `Entrée` persiste le nom (mutation `item.rename` acceptée) et la ligne
   affiche le nouveau nom ; le focus revient à la ligne, qui reste le point
   d'entrée clavier de l'arbre.
4. `Échap` ferme sans écriture et restaure le nom précédent ; le focus revient
   à la ligne.
5. Un clic hors du champ valide sans voler le focus de la cible cliquée.
6. Un brouillon vide, fait d'espaces, ou identique au nom courant ne produit
   aucune mutation.
7. Un nom refusé par le serveur laisse le champ ouvert avec la saisie.
8. Le rendu est lisible en thème clair et sombre, à 1440 px et à 390 px, sans
   décaler la ligne ni masquer les actions.
9. Le clic dans le champ ne déclenche ni navigation, ni menu contextuel, ni
   glisser-déposer de la ligne.

## Références produit

- `docs/product/product-canvas.md` : renommer ne change pas l'identité et ne
  casse pas les références ; l'édition inline se ferme par Entrée, Échap ou
  clic extérieur après sauvegarde.
- `specs/054-ui-parity-errors/errors.md` : E-064.
