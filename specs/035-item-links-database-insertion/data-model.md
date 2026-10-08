# Data model

Aucun type canonique ni SQL nouveau. pageLink.targetItemId reste un UUID d'élément
page/folder/database/database_view. Sa présentation résout titre/icône/lifecycle
depuis la projection courante. sourceId n'est jamais une cible de lien d'élément.

Choix d'insertion : bloc/parent capturés ; mode choose/existing ; sourceId choisi ;
busy/error/chargement ; viewId stable ; résultat créé conservé pour retry.
Une nouvelle base possède sa source ; une page liée n'en possède aucune.
Après confirmation durable, l'insertion utilise containerItemId et viewId stockés.

Import : liste des vues intégrées limitée aux bases is_inline===true.
Une base pleine page ou sans vue reste référencée par identité ; propriété et
placements identiques. Absence de is_inline conserve le lien et un avis.
