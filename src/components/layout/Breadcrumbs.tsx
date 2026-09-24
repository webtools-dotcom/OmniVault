import React from "react";
import { ChevronRight } from "lucide-react";
import { BreadcrumbItem } from "../../types";

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  onNavigateHome?: () => void;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ items }) => {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1.5 shrink-0 overflow-hidden select-none"
    >
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <React.Fragment key={item.id}>
            {index > 0 && (
              <ChevronRight className="w-3 h-3 text-vault-subtle shrink-0" aria-hidden="true" />
            )}
            {isLast ? (
              <span
                className="font-display font-semibold text-vault-primary text-base sm:text-xl tracking-[-0.012em] truncate max-w-[9.5rem] sm:max-w-[20rem]"
                aria-current="page"
                title={item.label}
              >
                {item.label}
              </span>
            ) : (
              <button
                onClick={item.onClick}
                className="text-vault-secondary hover:text-vault-primary text-xs transition-colors truncate max-w-[120px] sm:max-w-[180px] rounded px-1 py-0.5 focus:outline-none cursor-pointer"
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
