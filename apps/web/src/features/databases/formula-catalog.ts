/**
 * What the formula editor lists and documents. Every callable entry must exist
 * in the shared evaluator: a test compares this catalogue with
 * `FORMULA_FUNCTION_NAMES`, so the editor never advertises an unsupported
 * function. People functions and the AI assistant are out of product scope.
 */
export type FormulaCatalogKind = "number" | "text" | "boolean" | "date" | "list" | "any";

export interface FormulaCatalogEntry {
  /** Unique within the catalogue; operators and functions may share a name. */
  readonly key: string;
  readonly name: string;
  readonly kind: FormulaCatalogKind;
  readonly description: string;
  readonly examples: readonly string[];
  /** Text inserted at the caret; a function inserts `name()`. */
  readonly insert: string;
  readonly callable: boolean;
}

export interface FormulaCatalogGroup {
  readonly title: string;
  readonly entries: readonly FormulaCatalogEntry[];
}

function operator(
  name: string,
  kind: FormulaCatalogKind,
  description: string,
  examples: readonly string[],
  insert: string,
): FormulaCatalogEntry {
  return { key: `op:${name}`, name, kind, description, examples, insert, callable: false };
}

function callable(
  name: string,
  kind: FormulaCatalogKind,
  description: string,
  examples: readonly string[],
): FormulaCatalogEntry {
  return {
    key: `fn:${name}`,
    name: `${name}()`,
    kind,
    description,
    examples,
    insert: `${name}()`,
    callable: true,
  };
}

export const FORMULA_CATALOG: readonly FormulaCatalogGroup[] = [
  {
    title: "Intégrés",
    entries: [
      operator(
        "+",
        "number",
        "Additionne deux nombres ou assemble deux textes.",
        ["2 + 3", '"Bon" + "jour"'],
        "+",
      ),
      operator("-", "number", "Soustrait deux nombres.", ["5 - 2"], "-"),
      operator("*", "number", "Multiplie deux nombres.", ["3 * 2"], "*"),
      operator("/", "number", "Divise deux nombres.", ["6 / 3"], "/"),
      operator("%", "number", "Reste de la division.", ["7 % 4"], "%"),
      operator("^", "number", "Élève à la puissance.", ["2 ^ 3"], "^"),
      operator("==", "boolean", "Vrai si les deux valeurs sont égales.", ["1 == 1"], "=="),
      operator("!=", "boolean", "Vrai si les deux valeurs diffèrent.", ["1 != 2"], "!="),
      operator(">", "boolean", "Vrai si la première valeur est plus grande.", ["3 > 2"], ">"),
      operator(
        ">=",
        "boolean",
        "Vrai si la première valeur est plus grande ou égale.",
        ["3 >= 3"],
        ">=",
      ),
      operator("<", "boolean", "Vrai si la première valeur est plus petite.", ["2 < 3"], "<"),
      operator(
        "<=",
        "boolean",
        "Vrai si la première valeur est plus petite ou égale.",
        ["2 <= 2"],
        "<=",
      ),
      operator(
        "and",
        "boolean",
        "Vrai si les deux conditions sont vraies.",
        ["true and false"],
        "and",
      ),
      operator("or", "boolean", "Vrai si l’une des conditions est vraie.", ["true or false"], "or"),
      operator("not", "boolean", "Inverse une condition.", ["not true"], "not"),
      operator(
        "? :",
        "any",
        "Choisit une valeur selon une condition.",
        ['1 > 0 ? "oui" : "non"'],
        " ? : ",
      ),
      operator("true", "boolean", "La valeur vraie.", ["true"], "true"),
      operator("false", "boolean", "La valeur fausse.", ["false"], "false"),
    ],
  },
  {
    title: "Général",
    entries: [
      callable(
        "if",
        "any",
        "Renvoie la première valeur si la condition est vraie, sinon la seconde.",
        ['if(1 > 0, "oui", "non")'],
      ),
      callable(
        "ifs",
        "any",
        "Renvoie la valeur de la première condition vraie, sinon la dernière valeur.",
        ['ifs(1 > 2, "a", 2 > 1, "b", "c")'],
      ),
      callable("and", "boolean", "Vrai si toutes les valeurs sont vraies.", ["and(true, 1 > 0)"]),
      callable("or", "boolean", "Vrai si au moins une valeur est vraie.", ["or(false, 1 > 0)"]),
      callable("not", "boolean", "Inverse une valeur booléenne.", ["not(true)"]),
      callable(
        "empty",
        "boolean",
        "Vrai si la valeur est vide : rien, texte vide, 0, faux ou liste vide.",
        ['empty("")', "empty(0)"],
      ),
      callable("length", "number", "Nombre de caractères d’un texte ou d’éléments d’une liste.", [
        'length("Notion")',
        "[1, 2, 3].length()",
      ]),
      callable("format", "text", "Convertit une valeur en texte.", ["format(42)"]),
      callable("equal", "boolean", "Vrai si les deux valeurs sont égales.", ["equal(1, 1)"]),
      callable("unequal", "boolean", "Vrai si les deux valeurs diffèrent.", ["unequal(1, 2)"]),
      callable("let", "any", "Nomme une valeur puis l’utilise dans une expression.", [
        "let(x, 4, x * x)",
      ]),
      callable("lets", "any", "Nomme plusieurs valeurs puis les utilise dans une expression.", [
        "lets(a, 2, b, a + 1, a * b)",
      ]),
      callable("id", "text", "Identifiant de la page.", ["id()"]),
    ],
  },
  {
    title: "Texte",
    entries: [
      callable(
        "substring",
        "text",
        "Extrait une partie d’un texte, de l’indice de début à l’indice de fin exclu.",
        ['substring("Bonjour", 0, 3)'],
      ),
      callable("contains", "boolean", "Vrai si le texte contient la recherche.", [
        'contains("Bonjour", "jour")',
      ]),
      callable("test", "boolean", "Vrai si le texte correspond à l’expression régulière.", [
        'test("Notion", "^N")',
      ]),
      callable("match", "list", "Liste des passages qui correspondent à l’expression régulière.", [
        'match("a1b22", "\\\\d+")',
      ]),
      callable(
        "replace",
        "text",
        "Remplace la première correspondance de l’expression régulière.",
        ['replace("abc", "a.", "X")'],
      ),
      callable(
        "replaceAll",
        "text",
        "Remplace toutes les correspondances de l’expression régulière.",
        ['replaceAll("a-b-c", "-", " ")'],
      ),
      callable("lower", "text", "Met le texte en minuscules.", ['lower("NOTION")']),
      callable("upper", "text", "Met le texte en majuscules.", ['upper("notion")']),
      callable("trim", "text", "Retire les espaces au début et à la fin.", ['trim("  texte  ")']),
      callable("repeat", "text", "Répète le texte.", ['repeat("ab", 3)']),
      callable("padStart", "text", "Complète le début du texte jusqu’à la longueur voulue.", [
        'padStart("7", 3, "0")',
      ]),
      callable("padEnd", "text", "Complète la fin du texte jusqu’à la longueur voulue.", [
        'padEnd("7", 3, "0")',
      ]),
      callable("concat", "any", "Assemble des textes, ou réunit des listes.", [
        'concat("Bon", "jour")',
        "concat([1], [2])",
      ]),
      callable("join", "text", "Assemble les éléments d’une liste avec un séparateur.", [
        'join(["a", "b"], ", ")',
      ]),
      callable("split", "list", "Découpe un texte en liste selon un séparateur.", [
        'split("a,b,c", ",")',
      ]),
    ],
  },
  {
    title: "Numéro",
    entries: [
      callable("add", "number", "Additionne deux nombres.", ["add(2, 3)"]),
      callable("subtract", "number", "Soustrait deux nombres.", ["subtract(5, 2)"]),
      callable("multiply", "number", "Multiplie deux nombres.", ["multiply(-1, 2)"]),
      callable("divide", "number", "Divise deux nombres.", ["divide(6, 3)"]),
      callable("mod", "number", "Reste de la division.", ["mod(7, 4)"]),
      callable("pow", "number", "Élève à la puissance.", ["pow(2, 3)"]),
      callable("min", "number", "Plus petite valeur parmi des nombres ou une liste.", [
        "min(4, 1, 3)",
      ]),
      callable("max", "number", "Plus grande valeur parmi des nombres ou une liste.", [
        "max(4, 1, 3)",
      ]),
      callable("sum", "number", "Somme de nombres ou d’une liste.", [
        "sum(1, 2, 3)",
        "sum([1, 2, 3])",
      ]),
      callable("median", "number", "Valeur médiane.", ["median(1, 3, 100)"]),
      callable("mean", "number", "Moyenne.", ["mean(2, 4)"]),
      callable("abs", "number", "Valeur absolue.", ["abs(-3)"]),
      callable("round", "number", "Arrondit, éventuellement à un nombre de décimales.", [
        "round(3.14159, 2)",
        "round(1234, -2)",
      ]),
      callable("ceil", "number", "Arrondit à l’entier supérieur.", ["ceil(4.2)"]),
      callable("floor", "number", "Arrondit à l’entier inférieur.", ["floor(4.8)"]),
      callable("sqrt", "number", "Racine carrée.", ["sqrt(16)"]),
      callable("cbrt", "number", "Racine cubique.", ["cbrt(27)"]),
      callable("exp", "number", "Exponentielle.", ["exp(1)"]),
      callable("ln", "number", "Logarithme naturel.", ["ln(e())"]),
      callable("log10", "number", "Logarithme en base 10.", ["log10(1000)"]),
      callable("log2", "number", "Logarithme en base 2.", ["log2(8)"]),
      callable("sign", "number", "Signe du nombre : -1, 0 ou 1.", ["sign(-5)"]),
      callable("pi", "number", "La constante π.", ["pi()"]),
      callable("e", "number", "La constante e.", ["e()"]),
      callable("toNumber", "number", "Convertit un texte, une case ou une date en nombre.", [
        'toNumber("42")',
      ]),
    ],
  },
  {
    title: "Date",
    entries: [
      callable("now", "date", "Date et heure actuelles.", ["now()"]),
      callable("today", "date", "Date du jour, sans heure.", ["today()"]),
      callable("minute", "number", "Minute de la date (0 à 59).", ["minute(now())"]),
      callable("hour", "number", "Heure de la date (0 à 23).", ["hour(now())"]),
      callable("day", "number", "Jour de la semaine, de 1 (lundi) à 7 (dimanche).", ["day(now())"]),
      callable("date", "number", "Jour du mois (1 à 31).", ["date(now())"]),
      callable("week", "number", "Numéro de semaine ISO (1 à 53).", ["week(now())"]),
      callable("month", "number", "Mois (1 à 12).", ["month(now())"]),
      callable("year", "number", "Année.", ["year(now())"]),
      callable("dateAdd", "date", "Ajoute une durée à une date.", ['dateAdd(now(), 1, "days")']),
      callable("dateSubtract", "date", "Retire une durée à une date.", [
        'dateSubtract(now(), 1, "months")',
      ]),
      callable(
        "dateBetween",
        "number",
        "Écart entre deux dates dans l’unité demandée (première moins seconde).",
        ['dateBetween(now(), parseDate("2026-01-01"), "days")'],
      ),
      callable("dateRange", "date", "Crée une plage entre deux dates.", [
        'dateRange(today(), dateAdd(today(), 7, "days"))',
      ]),
      callable("dateStart", "date", "Début d’une plage de dates.", [
        "dateStart(dateRange(today(), now()))",
      ]),
      callable("dateEnd", "date", "Fin d’une plage de dates.", [
        "dateEnd(dateRange(today(), now()))",
      ]),
      callable("timestamp", "number", "Nombre de millisecondes depuis le 1er janvier 1970.", [
        "timestamp(now())",
      ]),
      callable("fromTimestamp", "date", "Date correspondant à un nombre de millisecondes.", [
        "fromTimestamp(1700000000000)",
      ]),
      callable(
        "formatDate",
        "text",
        "Met en forme une date avec un modèle (YYYY, MM, DD, HH, mm…).",
        ['formatDate(now(), "DD/MM/YYYY")'],
      ),
      callable("parseDate", "date", "Lit une date au format ISO.", ['parseDate("2026-11-06")']),
    ],
  },
  {
    title: "Liste",
    entries: [
      callable("at", "any", "Élément à l’indice donné ; un indice négatif part de la fin.", [
        "[1, 2, 3].at(1)",
      ]),
      callable("first", "any", "Premier élément.", ["[1, 2, 3].first()"]),
      callable("last", "any", "Dernier élément.", ["[1, 2, 3].last()"]),
      callable(
        "slice",
        "list",
        "Partie d’une liste, de l’indice de début à l’indice de fin exclu.",
        ["[1, 2, 3].slice(1, 2)"],
      ),
      callable("sort", "list", "Trie la liste, éventuellement selon une expression.", [
        "[3, 1, 2].sort()",
      ]),
      callable("reverse", "list", "Inverse l’ordre de la liste.", ["[1, 2, 3].reverse()"]),
      callable("unique", "list", "Retire les doublons.", ["[1, 1, 2].unique()"]),
      callable("includes", "boolean", "Vrai si la liste contient la valeur.", [
        '["a", "b"].includes("a")',
      ]),
      callable("find", "any", "Premier élément pour lequel l’expression est vraie.", [
        "[1, 2, 3].find(current > 1)",
      ]),
      callable(
        "findIndex",
        "number",
        "Indice du premier élément pour lequel l’expression est vraie.",
        ["[1, 2, 3].findIndex(current > 1)"],
      ),
      callable("filter", "list", "Garde les éléments pour lesquels l’expression est vraie.", [
        "[1, 2, 3].filter(current > 1)",
      ]),
      callable("some", "boolean", "Vrai si l’expression est vraie pour au moins un élément.", [
        "[1, 2, 3].some(current > 2)",
      ]),
      callable("every", "boolean", "Vrai si l’expression est vraie pour tous les éléments.", [
        "[1, 2, 3].every(current > 0)",
      ]),
      callable(
        "map",
        "list",
        "Transforme chaque élément ; current est l’élément, index sa position.",
        ["[1, 2, 3].map(current + index)"],
      ),
      callable("flat", "list", "Aplatit une liste de listes.", ["[[1], [2, 3]].flat()"]),
    ],
  },
];
