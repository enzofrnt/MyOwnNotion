import {
  BasicTextStyleButton,
  ColorStyleButton,
  CreateLinkButton,
  FormattingToolbar,
  FormattingToolbarController,
  NestBlockButton,
  UnnestBlockButton,
} from "@blocknote/react";
import type { ProjectedItem } from "@myownnotion/client-core";
import { PageLinkPicker } from "./page-link-picker.tsx";

function MyOwnNotionFormattingToolbar({
  currentItemId,
  items,
}: {
  readonly currentItemId: string;
  readonly items: readonly ProjectedItem[];
}) {
  return (
    <FormattingToolbar>
      <BasicTextStyleButton basicTextStyle="bold" />
      <BasicTextStyleButton basicTextStyle="italic" />
      <BasicTextStyleButton basicTextStyle="underline" />
      <BasicTextStyleButton basicTextStyle="strike" />
      <BasicTextStyleButton basicTextStyle="code" />
      <CreateLinkButton />
      <PageLinkPicker currentItemId={currentItemId} items={items} />
      <ColorStyleButton />
      <NestBlockButton />
      <UnnestBlockButton />
    </FormattingToolbar>
  );
}

/** Floating toolbar shared by text styles, external links, page links and canonical colours. */
export function EditorFormattingToolbar({
  currentItemId,
  items,
}: {
  readonly currentItemId: string;
  readonly items: readonly ProjectedItem[];
}) {
  return (
    <FormattingToolbarController
      formattingToolbar={() => (
        <MyOwnNotionFormattingToolbar currentItemId={currentItemId} items={items} />
      )}
    />
  );
}
