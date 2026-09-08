import React from "react";
import { cn } from "../../utils/cn";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "accent" | "success" | "pending" | "error" | "muted";
  size?: "sm" | "md";
}

export function Badge({
  className,
  variant = "default",
  size = "sm",
  children,
  ...props
}: BadgeProps) {
  const baseStyles = "inline-flex items-center justify-center font-medium rounded border select-none leading-none";

  const variantStyles = {
    default: "bg-vault-elevated text-vault-secondary border-vault-border",
    accent: "bg-vault-accent/15 text-vault-accent border-vault-accent/30",
    success: "bg-vault-success/15 text-vault-success border-vault-success/30",
    pending: "bg-vault-pending/15 text-vault-pending border-vault-pending/30",
    error: "bg-vault-error/15 text-vault-error border-vault-error/30",
    muted: "bg-transparent text-vault-muted border-vault-border",
  };

  const sizeStyles = {
    sm: "text-[11px] px-1.5 py-0.5 min-w-4.5 h-4.5",
    md: "text-xs px-2 py-0.5 min-w-5 h-5",
  };

  return (
    <span className={cn(baseStyles, variantStyles[variant], sizeStyles[size], className)} {...props}>
      {children}
    </span>
  );
}
