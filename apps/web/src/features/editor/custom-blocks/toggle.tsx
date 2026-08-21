import { defaultBlockSpecs } from "@blocknote/core";

/**
 * BlockNote Community already implements its toggle as an accessible
 * `<details>/<summary>` pair, including keyboard behaviour and nested blocks.
 * Keeping that implementation avoids a decorative imitation while the
 * canonical adapter continues to own the stable UUID.
 */
export const toggleBlockSpec = defaultBlockSpecs.toggleListItem;
