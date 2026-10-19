import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "link";
export type ButtonSize = "sm" | "md" | "lg" | "icon" | "icon-sm";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-contrast font-semibold hover:brightness-110 active:brightness-95 shadow-[0_6px_24px_-12px_var(--accent-glow)]",
  secondary:
    "bg-surface-3 text-ink border border-hairline hover:bg-surface-4 hover:border-hairline-strong",
  outline:
    "border border-hairline-strong text-ink-soft hover:text-ink hover:border-accent/45 hover:bg-accent/[0.06]",
  ghost: "text-ink-soft hover:text-ink hover:bg-surface-3",
  danger:
    "bg-danger/12 text-danger border border-danger/30 hover:bg-danger/20 hover:border-danger/50",
  link: "text-accent hover:text-accent-strong underline-offset-4 hover:underline px-0",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-2.5 text-2xs gap-1.5 rounded-[8px]",
  md: "h-9.5 px-3.5 text-micro gap-2 rounded-[10px]",
  lg: "h-11 px-5 text-sm gap-2 rounded-[11px]",
  icon: "size-9 justify-center rounded-[10px]",
  "icon-sm": "size-7 justify-center rounded-[8px]",
};

export function buttonClass(
  variant: ButtonVariant = "secondary",
  size: ButtonSize = "md",
  className?: string,
) {
  return cn(
    "relative inline-flex items-center whitespace-nowrap transition-[background,color,border-color,box-shadow,transform] duration-150 select-none",
    "disabled:pointer-events-none disabled:opacity-45",
    "active:translate-y-[0.5px]",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, iconLeft, iconRight, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={rest.type ?? "button"}
      disabled={disabled || loading}
      className={buttonClass(variant, size, className)}
      {...rest}
    >
      {loading ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin-slow" aria-hidden />
      ) : (
        iconLeft
      )}
      {children}
      {iconRight}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, "size" | "children"> {
  label: string;
  size?: "icon" | "icon-sm";
  children: ReactNode;
}

export function IconButton({ label, size = "icon", className, children, ...rest }: IconButtonProps) {
  return (
    <Button aria-label={label} title={label} size={size} className={className} {...rest}>
      {children}
    </Button>
  );
}
