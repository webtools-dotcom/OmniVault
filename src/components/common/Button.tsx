import React from "react";
import { cn } from "../../utils/cn";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "outline";
  size?: "sm" | "md" | "lg" | "icon";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "secondary", size = "md", children, disabled, ...props }, ref) => {
    const baseStyles =
      "inline-flex items-center justify-center font-medium transition-all duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vault-accent/50 disabled:pointer-events-none disabled:opacity-50 select-none cursor-pointer";

    const variantStyles = {
      primary:
        "bg-vault-accent text-white hover:bg-vault-accent-hover shadow-[0_2px_10px_rgba(59,130,246,0.3)] hover:shadow-[0_4px_16px_rgba(59,130,246,0.45)] border border-blue-400/20 active:shadow-xs",
      secondary:
        "bg-vault-elevated text-vault-primary hover:bg-vault-card border border-vault-border hover:border-vault-border-active shadow-xs",
      ghost:
        "text-vault-secondary hover:text-vault-primary hover:bg-vault-elevated/80 border border-transparent",
      danger:
        "bg-rose-500/10 text-rose-400 hover:text-white hover:bg-rose-600 border border-rose-500/20 hover:border-rose-600 shadow-xs",
      outline:
        "bg-transparent text-vault-secondary hover:text-vault-primary border border-vault-border hover:border-vault-border-active hover:bg-vault-elevated/40",
    };

    const sizeStyles = {
      sm: "h-8 px-3 text-xs rounded-lg gap-1.5",
      md: "h-9 px-4 text-xs sm:text-sm rounded-lg gap-2",
      lg: "h-11 px-5 text-sm sm:text-base rounded-xl gap-2.5",
      icon: "h-8 w-8 p-0 rounded-lg text-sm",
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
