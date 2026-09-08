/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        vault: {
          bg: "#080B0F",
          card: "#0F141C",
          elevated: "#161D27",
          overlay: "#1E2633",
          border: "rgba(255, 255, 255, 0.08)",
          "border-subtle": "rgba(255, 255, 255, 0.04)",
          "border-active": "#3B82F6",
          primary: "#F8FAFC",
          secondary: "#94A3B8",
          muted: "#64748B",
          accent: "#3B82F6",
          "accent-hover": "#60A5FA",
          "accent-subtle": "rgba(59, 130, 246, 0.12)",
          success: "#10B981",
          pending: "#F59E0B",
          error: "#EF4444",
        }
      }
    },
  },
  plugins: [],
}
