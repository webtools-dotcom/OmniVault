/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Half-step spacing and `xs` scales used across the UI are Tailwind v4
      // names; v3.4 drops them silently, so they are defined here instead of
      // being rewritten at ~40 call sites.
      spacing: {
        "0.2": "0.05rem",
        "4.5": "1.125rem",
        "6.5": "1.625rem",
        "7.5": "1.875rem",
        "8.5": "2.125rem",
        "9.5": "2.375rem",
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.28)",
      },
      backdropBlur: {
        xs: "4px",
      },
      colors: {
        vault: {
          bg: "#0A0B0E",
          sidebar: "#0F1117",
          panel: "#13151F",
          card: "#181A24",
          "card-hover": "#1F2230",
          elevated: "#222536",
          overlay: "#292C40",
          border: "rgba(255, 255, 255, 0.08)",
          "border-subtle": "rgba(255, 255, 255, 0.04)",
          "border-active": "rgba(99, 102, 241, 0.5)",
          primary: "#F4F4F7",
          secondary: "#9EA4B5",
          muted: "#666C80",
          subtle: "#4B5063",
          accent: "#4F46E5",
          "accent-hover": "#6366F1",
          "accent-subtle": "rgba(79, 70, 229, 0.12)",
          success: "#10B981",
          pending: "#F59E0B",
          error: "#EF4444",
        }
      }
    },
  },
  plugins: [],
}
