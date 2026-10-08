# Maintenance Matière — 2026-10-04

**Historique remplacé** : le propriétaire a refusé ce repli. [036](../036-multi-select-boards/spec.md) implémente le Kanban multi-select natif et rétablit les vues. Les preuves ci-dessous décrivent uniquement l’intervention antérieure.

Correction locale de FR-004/006/007/009/010 sur codex/notion-api-import ; pas de
publication demandée. Les autres phases gardent leurs preuves précédentes.

## Cause et limite native

Le navigateur reproduit l'erreur de la vue Matière. La présentation protégée
contient un board avec axe et group sur une propriété multi-select. Le moteur
refuse ce regroupement ; le rendu Kanban accepte seulement statut/sélection
simple. La conversion acceptait à tort multi-select et case pour le Kanban et
ne vérifiait pas le type de regroupement pour une table.

views.ts borne les deux cas aux capacités réelles et émet
import.view-grouping-preserved-as-table. Le repli est explicitement nommé
« table sans regroupement (import) ». Valeurs, filtres, tris et présentation des
propriétés compatibles sont conservés. L'original reste dans le snapshot
chiffré. Cette correction ne livre pas le regroupement par sélection multiple :
ses colonnes demandent une évolution du moteur et du rendu, signalée au propriétaire.

## Réparation bornée

L'audit compare chaque vue au plan initial protégé, en conservant la liste
actuelle des propriétés visibles. Les autres réglages doivent être identiques.
Deux vues dans deux conteneurs sont affectées ; aucune édition de ces réglages
ne doit être écrasée. Après sauvegarde complète vérifiée, une mutation canonique
database.presentation.replace avec révision attendue remplace seulement ces
deux vues. Readback exact réussi ; six autres onglets conservés, dont un ajout
postérieur à l'import. IDs, sources, schémas, entrées et valeurs inchangés.
Une seconde prévisualisation indique zéro réparation et deux vues déjà corrigées.
La définition de compatibilité stockait encore les anciennes vues : une seconde
sauvegarde vérifiée puis database.definition.replace les aligne sur la
présentation actuelle. La transaction vérifie aussi sa révision de présentation.
Deux définitions mises en cohérence et relues exactement ; propriétés inchangées,
présentations intégralement identiques. Cela évite qu'une édition de propriété
restaure les axes incompatibles. Le contrôle suivant ne demande aucune écriture.
Plan et reçu de réparation sont des records protégés ; cookies, lectures et
captures réelles restent privés sous work/notion-api, ignoré par Git.

## Vérification

- Conversion/collecte/CLI : 38 tests dans trois fichiers passent. Douze nouveaux
  cas couvrent board/table avec sélection multiple, case, texte, sélection
  simple, statut et propriété absente. Les cas compatibles gardent leur format ;
  les replis gardent leurs données, filtres/tris/propriétés et passent réellement
  evaluateDatabaseView. Le test initial reproduit les conversions erronées ;
  une assertion de position de fixture a été remplacée par le comportement utile.
- Application canonique : cinq tests d'intégration import passent sur les bases
  jetables explicites du PostgreSQL isolé 55433, avec libpq sur PATH.
- API : types, format/static ciblés et build de onze artefacts réussis. Aucun
  nouveau paquet, CSS, modèle canonique, SQL ou interaction utilisateur.
- Navigateur Chromium : quatre captures réelles couvrent clair/sombre et
  1440/320px. La table Matière s'ouvre, conserve les valeurs visibles, survit
  au rechargement et permet de revenir au Kanban Par état. Pas d'erreur JS ni 5xx.
  Les deux vues sont aussi ouvertes successivement hors ligne depuis le cache.
  Les premières assertions au clavier déclenchaient le déplacement clavier des
  onglets ; le contrôle final utilise leur sélection au pointeur. Aucune
  validation d'une nouvelle interaction clavier n'est revendiquée.
  Un premier contrôle supplémentaire attendait seulement cinq secondes durant
  l'hydratation initiale du workspace ; la reprise attend la disponibilité du
  conteneur avant de vérifier les vues. Les assertions de contenu sont conservées.
  Le tableau large et les onglets défilent dans leurs surfaces sur écran étroit.

## Livraison et cohérence

Image API notion-api-runtime reconstruite avec le nouveau bundle d'import,
redémarrage du seul service API myownnotion-notion-api. Web conservé ; HTTP 8082,
PostgreSQL 55433 et volumes propres. L'instance myownnotion-ui-dev garde ses
heures de démarrage API/Web 12:06:24/15:18:07 UTC, ses ports et ses volumes.

Le [guide](../../docs/notion-import.md) énonce maintenant les types de regroupement
pris en charge. Spec/plan/tasks et analyse de 028 gardent la trace du périmètre.
Le canevas §14 et les concepts de 029/035 ne changent pas. Contrôles de documents
et scan de secrets sur index candidat complètent les preuves ; l'index réel du
propriétaire reste intact. Le gate complet reste requis avant publication de
l'ensemble de cette branche, sans être présenté comme exécuté ici.
