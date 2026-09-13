import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import bash from "shiki/langs/bash.mjs";
import css from "shiki/langs/css.mjs";
import html from "shiki/langs/html.mjs";
import javascript from "shiki/langs/javascript.mjs";
import json from "shiki/langs/json.mjs";
import jsx from "shiki/langs/jsx.mjs";
import markdown from "shiki/langs/markdown.mjs";
import python from "shiki/langs/python.mjs";
import sql from "shiki/langs/sql.mjs";
import tsx from "shiki/langs/tsx.mjs";
import typescript from "shiki/langs/typescript.mjs";
import yaml from "shiki/langs/yaml.mjs";
import githubDark from "shiki/themes/github-dark.mjs";
import githubLight from "shiki/themes/github-light.mjs";
import type { HighlighterGeneric } from "shiki/types";

/** Only shipped grammars are offered. No registry/CDN or runtime WASM loading. */
export const CODE_LANGUAGES = [
  { value: "bash", label: "Bash", aliases: ["sh", "shell", "shellscript"] },
  { value: "css", label: "CSS", aliases: [] },
  { value: "html", label: "HTML", aliases: [] },
  { value: "javascript", label: "JavaScript", aliases: ["js"] },
  { value: "json", label: "JSON", aliases: [] },
  { value: "jsx", label: "JSX", aliases: [] },
  { value: "markdown", label: "Markdown", aliases: ["md"] },
  { value: "python", label: "Python", aliases: ["py"] },
  { value: "sql", label: "SQL", aliases: [] },
  { value: "tsx", label: "TSX", aliases: [] },
  { value: "typescript", label: "TypeScript", aliases: ["ts"] },
  { value: "yaml", label: "YAML", aliases: ["yml"] },
] as const;

/** Lookup only: the stored language is never rewritten by rendering. */
export function codeHighlightLanguage(language: string): string {
  const normalized = language.trim().toLowerCase();
  return (
    CODE_LANGUAGES.find(
      (entry) =>
        entry.value === normalized || (entry.aliases as readonly string[]).includes(normalized),
    )?.value ?? "text"
  );
}

let highlighter: Promise<HighlighterGeneric<string, string>> | undefined;

export function createCodeHighlighter(): Promise<HighlighterGeneric<string, string>> {
  highlighter ??= createHighlighterCore({
    themes: [githubLight, githubDark],
    langs: [bash, css, html, javascript, json, jsx, markdown, python, sql, tsx, typescript, yaml],
    engine: createJavaScriptRegexEngine(),
  }).then((created) => {
    // Compile each grammar against a tiny trusted sample before accepting
    // source. A cold JS-regex compilation can otherwise exhaust Shiki's
    // per-line budget mid-comment and leave following lines uncolored.
    // Real source keeps the default tokenization time limit.
    for (const { value } of CODE_LANGUAGES) {
      created.codeToTokensBase("x", {
        lang: value,
        theme: "github-light",
        tokenizeTimeLimit: 0,
      });
    }
    return created as HighlighterGeneric<string, string>;
  });
  return highlighter;
}
