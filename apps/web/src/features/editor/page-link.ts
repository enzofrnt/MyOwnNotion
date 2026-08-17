/** Internal page-link mark: a canonical target, never a hierarchy placement. */
import { Mark } from "@tiptap/core";

export const PageLink = Mark.create({
  name: "pageLink",
  inclusive: false,

  addAttributes() {
    return { targetItemId: { default: null } };
  },

  parseHTML() {
    return [
      {
        tag: "a[data-page-link-target]",
        getAttrs: (element) => ({
          targetItemId: element.getAttribute("data-page-link-target"),
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const targetItemId = HTMLAttributes["targetItemId"];
    return [
      "a",
      {
        href: typeof targetItemId === "string" ? `#page=${targetItemId}` : "#",
        "data-page-link-target": typeof targetItemId === "string" ? targetItemId : "",
        "aria-label": "Internal page link",
        class: "page-link",
      },
      0,
    ];
  },
});
