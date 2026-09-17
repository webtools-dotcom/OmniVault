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
      fontFamily: {
        // Archivo for the interface, Fraunces for titles. Both are self-hosted
        // in public/fonts: a vault that works with the Wi-Fi off cannot fetch
        // a webfont, and the fallbacks are what the UI would otherwise ship as.
        sans: ["Archivo", "Segoe UI", "Helvetica Neue", "Arial", "sans-serif"],
        display: ["Fraunces", "Georgia", "Times New Roman", "serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.28)",
      },
      backdropBlur: {
        xs: "4px",
      },
      colors: {
        vault: {
          // Every neutral carries the same cool hue, so nothing reads as dead
          // grey. D-070.
          bg: "#0D0E11",
          sidebar: "#101116",
          panel: "#101116",
          card: "#15161B",
          "card-hover": "#191A20",
          elevated: "#1C1D23",
          overlay: "#24252C",
          border: "rgba(233, 234, 239, 0.07)",
          "border-subtle": "rgba(233, 234, 239, 0.04)",
          "border-active": "rgba(233, 234, 239, 0.22)",
          primary: "#E9EAEF",
          secondary: "#A8AAB6",
          muted: "#868A96",
          subtle: "#6E7280",
          // The primary action is ink on the ground, not a colour. The only
          // chromatic values in the product are the two that mean something.
          accent: "#E9EAEF",
          "accent-hover": "#FFFFFF",
          "accent-subtle": "rgba(233, 234, 239, 0.10)",
          ink: "#12131A",
          success: "#79C2A4",
          pending: "#8E9AA8",
          error: "#DE8A80",
          // Folder identity: the one place a hue is picked for recognition
          // rather than meaning, and never the only way to tell two apart.
          moss: "#7E9E86",
          slate: "#7D8CA8",
          plum: "#9E86A0",
        }
      }
    },
  },
  plugins: [],
}
