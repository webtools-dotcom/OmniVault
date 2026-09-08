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
          bg: "#0E0E11",
          card: "#151519",
          elevated: "#1B1B22",
          overlay: "#23232C",
          border: "rgba(255, 255, 255, 0.08)",
          "border-subtle": "rgba(255, 255, 255, 0.04)",
          "border-active": "rgba(255, 255, 255, 0.20)",
          primary: "#EDEDED",
          secondary: "#A1A1AA",
          muted: "#71717A",
          subtle: "#52525B",
          accent: "#3B82F6",
          "accent-hover": "#60A5FA",
          "accent-subtle": "rgba(59, 130, 246, 0.10)",
          success: "#10B981",
          pending: "#F59E0B",
          error: "#EF4444",
        }
      }
    },
  },
  plugins: [],
}
