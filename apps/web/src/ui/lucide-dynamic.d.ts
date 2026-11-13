declare module "lucide-react/dist/esm/DynamicIcon.mjs" {
  import type { ComponentType, SVGProps } from "react";

  interface DynamicIconProps extends Omit<SVGProps<SVGSVGElement>, "ref"> {
    readonly name: string;
    readonly size?: number | string;
  }

  const DynamicIcon: ComponentType<DynamicIconProps>;
  export const iconNames: readonly string[];
  export default DynamicIcon;
}
