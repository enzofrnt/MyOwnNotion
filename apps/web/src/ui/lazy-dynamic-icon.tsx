import type { LucideProps } from "lucide-react";
import DynamicIcon from "lucide-react/dist/esm/DynamicIcon.mjs";
import { useEffect, useRef, useState } from "react";

/**
 * Lucide ships thousands of icons as individual lazy modules. Only request one
 * once its cell approaches the viewport; a full catalogue must not trigger
 * thousands of imports when the picker opens.
 */
export function LazyDynamicIcon({
  name,
  size = 22,
  ...props
}: LucideProps & { readonly name: string }) {
  const holder = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = holder.current;
    if (element === null) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "160px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const dimension = typeof size === "number" ? size : undefined;
  return (
    <span
      ref={holder}
      className="symbol-icon-lazy"
      style={dimension === undefined ? undefined : { minWidth: dimension, minHeight: dimension }}
    >
      {visible ? <DynamicIcon name={name} size={size} {...props} /> : null}
    </span>
  );
}
