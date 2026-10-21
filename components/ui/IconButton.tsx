import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { iconButtonClass, type IconButtonSize, type IconButtonVariant } from "./variants.ts";

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children"> & {
  /** Required: an icon-only control has no other accessible name. */
  "aria-label": string;
  /** The icon element, e.g. <X className="h-4 w-4" />. Hidden from assistive tech. */
  icon: ReactNode;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  ref?: Ref<HTMLButtonElement>;
};

/** Icon-only button with a 36px minimum hit area at every size. */
export function IconButton({ icon, variant, size, className, type = "button", ref, ...rest }: IconButtonProps) {
  return (
    <button ref={ref} type={type} className={iconButtonClass({ variant, size, className })} {...rest}>
      <span aria-hidden="true" className="inline-flex">
        {icon}
      </span>
    </button>
  );
}
