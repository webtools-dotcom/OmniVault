import React from "react";
import { ChevronRight, ShieldCheck } from "lucide-react";
import { BreadcrumbItem } from "../../types";

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  onNavigateHome?: () => void;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ items, onNavigateHome }) => {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center space-x-1.5 text-xs sm:text-sm overflow-x-auto py-1">
      <button
        onClick={onNavigateHome}
        className="flex items-center gap-1.5 text-vault-secondary hover:text-vault-primary transition-colors focus:outline-none rounded px-1 py-0.5"
        title="OmniVault Home"
      >
        <ShieldCheck className="w-4 h-4 text-vault-accent shrink-0" />
        <span className="font-medium hidden xs:inline">OmniVault</span>
      </button>

      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <React.Fragment key={item.id}>
            <ChevronRight className="w-3.5 h-3.5 text-vault-muted shrink-0" aria-hidden="true" />
            {isLast ? (
              <span
                className="text-vault-primary font-medium truncate max-w-[140px] sm:max-w-[240px] px-1 py-0.5"
                aria-current="page"
                title={item.label}
              >
                {item.label}
              </span>
            ) : (
              <button
                onClick={item.onClick}
                className="text-vault-secondary hover:text-vault-primary transition-colors truncate max-w-[110px] sm:max-w-[180px] rounded px-1 py-0.5 focus:outline-none"
                title={item.label}
              >
                {item.label}
              </button>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
};
