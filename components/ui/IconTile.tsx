import type { HTMLAttributes, ReactNode } from "react";
import { iconTileClass, type IconTileSize, type IconTileTone } from "./premium.ts";

export type IconTileProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: IconTileTone;
  size?: IconTileSize;
  round?: boolean;
  children: ReactNode;
};

/** Square (logo) or round (avatar / status) tile that holds an icon, a favicon or initials. Decorative: callers label the row. */
export function IconTile({ tone = "neutral", size = "md", round, className, children, ...rest }: IconTileProps) {
  return (
    <span className={iconTileClass({ tone, size, round, className })} {...rest}>
      {children}
    </span>
  );
}
