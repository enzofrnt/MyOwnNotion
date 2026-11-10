# Feature Specification: Fichiers et médias

**Feature Branch**: `046-database-files`

**Created**: 2026-11-04

**Status**: Implémenté (2026-11-04)

**Input**: Ajouter le type Notion « Fichiers et médias » : lier un ou plusieurs
fichiers canoniques à une ligne, depuis le volet d'entrée.

## Product Direction

Canevas sections 10, 14 et 15. Un fichier reste un élément canonique de
l'application ; la propriété ne stocke que son identité, jamais les octets.

## Décision

- Type `files`, configuration vide.
- Valeur `{ kind: "files", fileIds }`, 20 fichiers maximum, identités uniques.
- L'upload réutilise le transfert chunké existant et place le fichier comme
  pièce jointe de l'entrée.
- La grille affiche le nombre de fichiers ; l'édition se fait dans le volet
  d'entrée (liste, ajout, retrait). Ce choix évite d'ouvrir un sélecteur de
  fichiers dans une cellule virtualisée.

## User Scenarios

### User Story 1 — Joindre un fichier à une ligne (P1)

Le propriétaire ouvre une ligne en volet, ajoute un fichier à « Pièces
jointes », le voit listé avec son nom, puis le retrouve après rechargement.

**Acceptance** :

1. « Ajouter un fichier » ouvre le sélecteur et transfère le fichier.
2. Le nom apparaît dans la liste ; la grille affiche « 1 fichier ».
3. Retirer le fichier vide la propriété.
4. Un fichier de plus de 20 éléments est refusé (borne de valeur).

## Requirements

- **FR-001** : type `files` à configuration vide.
- **FR-002** : valeur limitée à 20 identités uniques.
- **FR-003** : aucun octet dans la valeur ; seule l'identité du fichier est
  stockée.
- **FR-004** : upload via le transfert chunké existant, fichier rattaché à
  l'entrée.
- **FR-005** : grille : nombre de fichiers ; volet : noms, ajout, retrait.
- **FR-006** : une suppression de fichier retire l'identité de la valeur.

## Out of Scope

Aperçus et vignettes dans la grille, upload direct depuis une cellule, import
des médias Notion dans cette propriété, réorganisation des fichiers.
