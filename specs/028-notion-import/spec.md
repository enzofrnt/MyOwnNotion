# Feature Specification: Import Notion par API

**Branch**: `codex/notion-api-import` · **Updated**: 2026-10-04 · **Status**: Implemented locally

Remplace l'import de fichiers historique de 028 à la demande du propriétaire.
Le document fourni est une référence, pas une autorisation de modifier Notion.
Canevas §§ 4, 6.1, 14, 15, 17–19, 27.1, 28–33 et 42–44 ; dépendances 024/029.

## User Scenarios & Testing

### US1 — Découvrir puis prévisualiser (P1)

Le propriétaire fournit un secret d'intégration et choisit les objets visibles
à importer. L'aperçu explique les différences avant toute écriture locale.
Pourquoi : connaître les pertes possibles.
**Independent test** : source paginée comprenant pages et plusieurs sources.

1. La découverte énumère pages, bases et sources accessibles ; sélection par
   identité explicite ou de tous les objets accessibles.
2. L'aperçu ne connecte aucune cible et ne modifie jamais Notion.
3. Une permission manquante sur un objet sélectionné produit une erreur explicite ; aucun secret ni
   contenu privé n'entre dans les journaux ordinaires.

### US2 — Retrouver pages et véritables bases locales (P1)

L'application explicite crée un groupe d'import indépendant. Pourquoi :
retrouver des données natives exploitables, y compris hors ligne.
**Independent test** : importer puis relire par les API ordinaires et inspecter
le stockage protégé.

1. Pages, ordre du contenu, hiérarchie, texte riche, sous-blocs, tableaux,
   liens internes et médias pris en charge restent exploitables.
2. Chaque base conserve ses sources distinctes et chaque ligne appartient à
   sa source correcte sous son propriétaire. Relations résolues après création.
3. Les propriétés natives conservent valeurs, options et couleurs ; les types
   sans équivalent conservent leur valeur en lecture et leur original protégé.
   À la demande du propriétaire, les propriétés Personne, auteur et dernier
   éditeur sont ignorées.
   Les couvertures Notion ne sont ni téléchargées ni exposées comme pièces jointes.
4. Les vues récupérables sont traduites quand fidèles ; toute configuration
   incompatible est conservée et signalée. Aucun filtre n'est silencieusement
   supprimé en prétendant reproduire la vue source.
5. Une sauvegarde complète vérifiée précède l'application ; état d'installation,
   clés, migrations et politique d'écriture sont contrôlés.
6. Une page importée contenant une base intégrée s'ouvre dans l'éditeur, conserve
   ses références après activation/reprise et reste éditable sans erreur serveur.
   Aucun dossier technique « Sources importées » n'apparaît dans ses notes ;
   l'original reste dans le snapshot privé de reprise.

### US3 — Reprendre sans écraser (P2)

Un import interrompu reprend depuis son snapshot chiffré après redémarrage.
Pourquoi : les sources changent et les URL de fichiers expirent.
**Independent test** : interrompre après une écriture, reprendre deux fois,
modifier ensuite une page et rejouer sans remplacement.

1. Identités et checkpoints sont stables et transactionnels.
2. La reprise n'exige aucune nouvelle lecture de Notion et ne duplique rien.
3. Toute erreur partielle est visible et son original conservé ; une erreur
   d'accès aux objets sélectionnés pendant la collecte bloque l'application.
   Un original de bloc synchronisé non partagé produit un placeholder et un avis
   explicites ; sa référence est conservée, sans prétendre importer son contenu.

### Edge Cases

Pagination des blocs, recherche, lignes, propriétés et vues ; curseur répété ;
429/Retry-After, panne temporaire, délai et annulation ; cycles, synced blocks,
références hors sélection ; plusieurs sources et bases liées ; fichiers
expirés, redirections et réseau privé ; types inconnus ; modification concurrente
de la source ; reprise après modification locale.

## Requirements

La correction propriétaire du 2026-10-04 complète le contrat : résoudre le
parent d'une base même s'il s'agit d'un bloc de mise en page contenu dans une
page ; permettre l'exclusion explicite d'une base avec ses sources et entrées,
sans exclusion globale par nom. Le jeu de test exclut People et conserve
Archive > Lycée > Simple Note. Les équations de bloc/en ligne et sommaires
deviennent natifs avec 034 ; la réparation de l'import existant conserve les
identités et n'écrase aucune édition locale.

- **FR-001** : Remplacer fichiers/ZIP/Obsidian par l'intégration Notion en lecture
  seule, découverte, sélection et aperçu par défaut.
- **FR-002** : Paginer intégralement, centraliser débit et tentatives bornées,
  respecter l'attente demandée et permettre l'annulation.
- **FR-003** : Préserver contenu et références par identités source, sans fusion
  par titre ni dépendance à l'ordre de parcours.
- **FR-004** : Importer bases, sources, schémas, lignes, relations et vues selon
  le modèle de la section 14 ; signaler les limites de représentation.
- **FR-005** : Copier les médias Notion vers le stockage canonique. Les médias
  externes restent des liens par défaut avec un avis explicite. Les couvertures
  de pages/bases sont exclues, même si elles figurent dans un ancien snapshot.
- **FR-006** : Conserver originaux et snapshot de reprise chiffrés ; protéger
  les écritures par sauvegarde complète et contrôles existants. Garder ces
  archives techniques hors de l'arborescence visible des notes.
- **FR-007** : Garantir reprise idempotente et conservation des éditions locales.
- **FR-008** : Aucun jeton dans snapshots, rapports, code ou journaux ; aucune
  authentification Notion transmise aux hôtes de médias.
- **FR-009** : Développer et valider sur une instance indépendante avec ports,
  volumes, secret de déploiement et checkout propres.
- **FR-010** : Documenter commandes, limites observées et différences demandant
  une évolution de MyOwnNotion, sans synchronisation continue.

### Key Entities

Connexion éphémère ; objets source (page, base, source, bloc, vue, fichier) ;
snapshot privé ; registre d'identités ; plan ; rapport ; job et checkpoints.

## Success Criteria

- **SC-001** : Tous les éléments des fixtures paginées sont présents dans leur
  source correcte avec références résolues et zéro perte non signalée.
- **SC-002** : Une reprise et deux rejouements gardent les identités et
  conservent une édition locale postérieure.
- **SC-003** : Inspection SQL/fichiers : aucun original ni secret en clair ;
  sauvegarde impossible ou source incomplète implique zéro contenu appliqué.
- **SC-004** : Conteneurs et volumes de l'instance UI existante inchangés.

## Assumptions

Le parcours reste une CLI, comme l'import remplacé ; aucune nouvelle UI demandée.
L'import est ponctuel. Le jeton fourni autorise uniquement les lectures Notion
et l'application dans l'instance isolée. L'application exige sélection explicite
et identité de job. Les propriétés Personne, auteur et dernier éditeur sont
ignorées. Les noms présents
dans le texte éditorial ne créent ni propriété ni compte. Les couvertures sont
exclues du produit, selon la clarification du propriétaire du 2026-10-04.

## Clarifications — test propriétaire, 2026-10-04

Ignorer Personne et couvertures ; ne pas présenter l'archive d'import comme
une page Notion. Corriger les pages avec bases intégrées en préservant les
identités, les modifications faites depuis le premier essai et l'instance UI.


## Ajustement des liens et commandes — 035

Le retour du propriétaire du 4 octobre est défini dans
[035/spec.md](../035-item-links-database-insertion/spec.md), avec approche et
suivi dans ses plan.md/tasks.md. Il remplace les libellés précédents par les
créations « Page/Dossier/Base de données imbriqué(e) », élargit « Lien vers un
autre élément » aux bases, et fusionne les commandes d'affichage intégré et lié
dans un dialogue de choix. Le concept de vue liée et la propriété des sources
restent inchangés. L'import respecte is_inline et corrige les références
historiques inchangées ; la validation locale propre à035 ne revalide pas les
anciennes phases de cette feature.

## Matière et regroupement natif — 2026-10-04

Le propriétaire exige le support natif du regroupement par sélection multiple.
[036](../036-multi-select-boards/spec.md) étend le moteur, la projection et le
Kanban ; l'import conserve donc ce format, son nom, son axe, ses filtres/tris et
ses propriétés visibles. Le repli table antérieur est supprimé pour ce cas.
Les autres types encore incompatibles restent soumis à FR-004/010.

La restauration historique reste bornée : sauvegarde vérifiée, comparaison à
l'état connu, commandes canoniques sous révision, présentation et copie de vues
cohérentes, propriétés actuelles et autres onglets conservés. Elle concerne
uniquement l'instance isolée 8082. Les [anciennes preuves](validation-matiere.md)
sont historiques ; les résultats natifs sont dans [036/validation.md](../036-multi-select-boards/validation.md).

## Extension 036 — 2026-10-04

[036](../036-multi-select-boards/spec.md) ajoute le regroupement Kanban par sélection multiple, sans repli table pour ce cas. Les anciennes preuves Matière restent historiques ; la restauration ciblée et la validation native sont suivies dans 036.
