import React from "react";
import { cn } from "../../utils/cn";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "outline";
  size?: "sm" | "md" | "lg" | "icon";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "secondary", size = "md", children, disabled, ...props }, ref) => {
    const baseStyles =
      "inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-vault-border-active disabled:pointer-events-none disabled:opacity-50 select-none";

    const variantStyles = {
      primary:
        "bg-vault-accent text-white hover:bg-vault-accent-hover shadow-sm border border-transparent",
      secondary:
        "bg-vault-elevated text-vault-primary hover:bg-vault-card border border-vault-border",
      ghost:
        "text-vault-secondary hover:text-vault-primary hover:bg-vault-elevated border border-transparent",
      danger:
        "bg-vault-card text-vault-error hover:bg-vault-elevated border border-vault-border hover:border-vault-error/40",
      outline:
        "bg-transparent text-vault-secondary hover:text-vault-primary border border-vault-border hover:border-vault-border-active",
    };

    const sizeStyles = {
      sm: "h-8 px-2.5 text-xs rounded-md gap-1.5",
      md: "h-9 px-3.5 text-sm rounded-md gap-2",
      lg: "h-11 px-5 text-base rounded-md gap-2.5",
      icon: "h-8 w-8 p-0 rounded-md text-sm",
    };

    return (
      <button
        ref={ref}
        className={cn(baseStyles, variantStyles[variant], sizeStyles[size], className)}
        disabled={disabled}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
