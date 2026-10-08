# Validation du transfert à la première ouverture

Date : 7 octobre 2026. Périmètre : helper de développement de l'instance
isolée 8082. Références : [spec](spec.md), [plan](plan.md), [tâches](tasks.md)
et [analyse](analysis.md). La stack de production est hors périmètre.

## Correction livrée

[Caddyfile.dev](../../docker/Caddyfile.dev) négocie gzip au niveau 1 pour les
fichiers publics servis par Vite, hors `/v1*`, `/mcp*` et `/health*`, ainsi que
pour l'endpoint exact `GET /v1/changes` lorsque sa réponse est
`application/json`. Aucun cache n'est ajouté. Les directives de proxy,
d'origine et de diffusion immédiate sont conservées.

La configuration finale a été validée par Caddy 2.10.2 puis appliquée par
**reload de Caddy sur 8082 uniquement**. API, PostgreSQL et instance 8080 n'ont
pas été redémarrés ou recréés pour cette correction. Aucun contenu, protocole,
DTO, ordre de réconciliation, historique, chiffrement ou activation éditoriale
n'est modifié. Aucune publication Git ni validation globale de production
n'est revendiquée ici.

## Mesures de transfert

Le HAR du propriétaire contient 370 requêtes et environ 35,5 Mo transférés,
sans compression observée. Il capture des modules Vite et un rattrapage
authentifié, avec un délai de saisie avant connexion. Il ne contient pas de
métrique FCP/onload. Les streams SSE ouverts et les requêtes incomplètes sont
exclus des durées finies ; la durée globale n'est pas un temps d'ouverture.

Les corps capturés éligibles ont été compressés **en mémoire**, puis vérifiés
par décompression byte à byte. Les tailles ci-dessous sont des octets de corps,
sans en-têtes HTTP ; Mo désigne un million d'octets.

| Catégorie | Réponses | Corps d'origine | Estimation gzip 1 | Réduction |
| --- | ---: | ---: | ---: | ---: |
| Fichiers publics de développement | 328 | 17 008 077 | 6 408 875 | 62,3 % |
| Pages JSON de changements | 16 | 19 831 874 | 5 668 608 | 71,4 % |
| Total éligible | 344 | 36 839 951 | 12 077 483 | 67,2 % |

Cela représente **36,84 → 12,08 Mo estimés**, sans prédire une réduction
équivalente du temps d'ouverture. La somme des temps CPU de compression dans
la passe enregistrée est d'environ 82 ms au niveau 1, contre 212 ms au niveau 6 ;
ces valeurs locales ne sont pas un benchmark du proxy Docker.

Mesure réelle d'un asset WASM public sur 8082 :
**3 179 170 → 1 225 657 octets** avec gzip 1, soit environ 61,4 % de réduction.
Cette mesure de transfert est distincte de l'estimation globale du HAR.

Le rattrapage contient 2 894 événements, soit 3 595 occurrences d'éléments
pour 1 097 identités distinctes. Les documents occupent 13 339 082 octets sur
3 098 occurrences, contre 3 771 250 octets pour les 870 versions de document
distinctes. Le plus gros document fait 98 677 octets ; aucun n'excède 1 Mo.
Les grosses réponses agrègent donc de nombreux documents, souvent répétés par
l'historique. Cette répétition reste inchangée : les pages et curseurs ordonnés
ne sont ni sautés, ni parallélisés, ni dédupliqués par cette maintenance.

## Contrôles techniques enregistrés

- **41 tests de contrat réussis** : `compose-dev` (12), `compose-security` (24)
  et `realtime-proxy` (5). Ils couvrent la frontière de compression et les
  contraintes existantes de proxy/Compose.
- `bun run compose:check` : réussi, avec services, ports loopback, secrets,
  images et upgrade realtime conformes.
- Caddy 2.10.2 : configuration finale valide. Les avertissements relatifs aux
  en-têtes `X-Forwarded-*` déjà redondants ne bloquent pas la validation.
- **17 contrôles fonctionnels synthétiques réussis** avec un Caddy jetable et
  un upstream Bun indépendant de l'application : cinq comparaisons gzip et
  identity pour JS, client Vite, CSS, WASM et changements JSON ; huit réponses
  privées/non éligibles sans compression ; `POST /v1/changes` et réponse
  `application/problem+json` sans compression ; SSE immédiat ; WebSocket HMR.
  Les corps décompressés et identity sont strictement identiques. Auth,
  récupération, fichier privé, chemin enfant de changements, MCP et health
  restent sans nouvelle compression. Aucun cookie ou contenu du propriétaire
  n'est utilisé par ces fixtures.
- Dans la passe finale, le premier événement SSE arrive en **16 ms** pour
  changements et **2 ms** pour MCP, avant la fin volontaire du stream à
  1 800 ms. L'upgrade WebSocket reçoit son message synthétique de disponibilité.
  Le conteneur jetable est supprimé et le serveur de fixture arrêté ensuite.

Preuves locales ignorées dans `work/notion-api/` : `039-har-summary.ts`,
`039-har-summary.json`, `039-proxy-smoke.ts`, `039-proxy-smoke-final.log`,
`039-proxy-contracts-final.log`, `039-compose-check.log`,
`039-caddy-validate.log` et `039-caddy-reload-final.log`. Le HAR, les corps,
cookies, en-têtes privés et données utilisateur ne sont pas ajoutés à Git.

## Revue réelle et limites de convergence

Rechargements réels sur 8082 avec cache HTTP désactivé, projection locale et
cookie conservés :

| Configuration | Trois mesures en ms | Médiane en ms |
| --- | --- | ---: |
| Avant compression | 1 254 / 1 093 / 1 204 | 1 204 |
| Gzip niveau 1 final | 1 397 / 1 117 / 1 009 | 1 117 |

La mesure utilise une horloge extérieure à l'outil et attend la présence des
17 cartes. Les échantillons sont bruités et se recouvrent : **un gain de
latence utilisateur n'est pas établi**. Ce n'est ni une première connexion
sur un appareil vide, ni un indicateur FCP. Aucun effacement de projection ou
de cookie n'est effectué pour cette comparaison.

Une fixture « Vérification rapidité 039 » est créée par le bouton Nouvelle
page de Pas commencé, avec titre et case Examen cochée, puis autosave par
Entrée. Après rechargement, les 18 cartes sont présentes et la case de cette
fixture reste cochée. La fixture seule est ensuite envoyée à la corbeille par
son menu canonique : dernière lecture à 17 cartes, fixture absente,
aucune édition dépliée et aucun dialogue ouvert. Aucune entrée existante
n'est modifiée. Le viewport est rétabli à 1454 × 909, les overrides média
retirés et le cache HTTP normal réactivé.

Le reload isolé, le transfert WASM et l'édition durable sont donc vérifiés,
conformément au
[skill UI quality](../../.agents/skills/ui-quality/SKILL.md) et à son
[journal](../../.agents/skills/ui-quality/lessons.md). T001–T003 sont complets ;
la convergence de cette maintenance est établie pour le périmètre 8082.
Le coût structurel de l'historique et la cascade des modules Vite restent
des limites explicites, sans modification de protocole ni promesse de temps
d'ouverture.

Cette consignation est documentaire : aucun test applicatif, build ou
conteneur supplémentaire n'est lancé. Liens, cohérence spec/plan/tâches,
présence des artefacts et espaces du diff sont contrôlés selon
[docs/development.md](../../docs/development.md).
