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
import { useCallback } from "react";
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
  // FormattingToolbarController renders this prop as a component type. A fresh
  // inline arrow on every parent render would remount the whole toolbar
  // subtree — dismissing an open page-link picker mid-gesture — whenever an
  // unrelated session event (autosave, conversion handover) re-rendered the
  // editor. Identity must change only when the inputs actually do.
  const toolbar = useCallback(
    () => <MyOwnNotionFormattingToolbar currentItemId={currentItemId} items={items} />,
    [currentItemId, items],
  );
  return <FormattingToolbarController formattingToolbar={toolbar} />;
}
