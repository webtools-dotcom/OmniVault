import React from "react";
import { ChevronRight } from "lucide-react";
import { BreadcrumbItem } from "../../types";

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  onNavigateHome?: () => void;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ items }) => {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center space-x-1 text-xs overflow-x-auto select-none">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <React.Fragment key={item.id}>
            {index > 0 && (
              <ChevronRight className="w-3 h-3 text-zinc-600 shrink-0" aria-hidden="true" />
            )}
            {isLast ? (
              <span
                className="text-zinc-200 font-medium text-xs truncate max-w-[160px] sm:max-w-[240px] px-1 py-0.5"
                aria-current="page"
                title={item.label}
              >
                {item.label}
              </span>
            ) : (
              <button
                onClick={item.onClick}
                className="text-zinc-400 hover:text-zinc-200 text-xs transition-colors truncate max-w-[120px] sm:max-w-[180px] rounded px-1 py-0.5 focus:outline-none cursor-pointer"
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
