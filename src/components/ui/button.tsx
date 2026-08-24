import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost";

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cn(
        "inline-flex min-h-11 items-center justify-center rounded-md px-5 text-sm font-medium tracking-wide",
        "transition-opacity duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg",
        "disabled:pointer-events-none disabled:opacity-50",
        "active:scale-[0.98]",
        variant === "primary" && "bg-fg text-accent-fg hover:opacity-90",
        variant === "secondary" &&
          "border border-border bg-bg-elevated text-fg hover:border-border-strong",
        variant === "ghost" && "text-muted hover:text-fg",
        className,
      )}
      {...props}
    />
  );
}
