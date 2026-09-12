import {
  createAtomBlockMarkdownSpec,
  createBlockMarkdownSpec,
  createInlineMarkdownSpec,
} from "@tiptap/core";

const maxPayloadBytes = 256 * 1024;
const repeatedAttribute = "__QUOTED_0";
const repeatCount = Math.floor((maxPayloadBytes - 64) / repeatedAttribute.length);
const craftedAttributes = `${repeatedAttribute.repeat(repeatCount)}__QUOTED_0__`;
const craftedAtomBlock = `:::probe {${craftedAttributes}} :::\n`;
const craftedBlock = `:::probe {${craftedAttributes}}\ncontent\n:::\n`;
const craftedInline = `[probe ${"0".repeat(maxPayloadBytes - 16)}]`;

const atomSpec = createAtomBlockMarkdownSpec({ nodeName: "probe" });
const blockSpec = createBlockMarkdownSpec({ nodeName: "probe" });
const inlineSpec = createInlineMarkdownSpec({ nodeName: "probe", selfClosing: true });

const mode = process.argv[2];

if (mode === "ordinary") {
  const atom = atomSpec.markdownTokenizer.tokenize(
    ':::probe {title="hello world" enabled} :::\n',
    [],
    undefined as never,
  );
  const block = blockSpec.markdownTokenizer.tokenize(
    ':::probe {title="hello world" enabled}\ncontent\n:::\n',
    [],
    {
      blockTokens: () => [],
      inlineTokens: () => [],
    },
  );
  const inline = inlineSpec.markdownTokenizer.tokenize(
    '[probe title="hello world" enabled]',
    [],
    undefined as never,
  );
  const atomAttributes = atom && "attributes" in atom ? atom.attributes : undefined;
  const blockAttributes = block && "attributes" in block ? block.attributes : undefined;
  const inlineAttributes = inline && "attributes" in inline ? inline.attributes : undefined;

  if (
    atomAttributes?.title !== "hello world" ||
    atomAttributes?.enabled !== true ||
    blockAttributes?.title !== "hello world" ||
    blockAttributes?.enabled !== true ||
    inlineAttributes?.title !== "hello world"
  ) {
    throw new Error("ordinary quoted Markdown attributes did not parse");
  }
  process.stdout.write("ordinary-ok\n");
} else if (mode === "atom-block") {
  atomSpec.markdownTokenizer.tokenize(craftedAtomBlock, [], undefined as never);
  process.stdout.write("atom-block-ok\n");
} else if (mode === "block-block") {
  blockSpec.markdownTokenizer.tokenize(craftedBlock, [], {
    blockTokens: () => [],
    inlineTokens: () => [],
  });
  process.stdout.write("block-block-ok\n");
} else if (mode === "inline") {
  inlineSpec.markdownTokenizer.tokenize(craftedInline, [], undefined as never);
  process.stdout.write("inline-ok\n");
} else {
  throw new Error(`unknown fixture mode: ${mode ?? "missing"}`);
}
