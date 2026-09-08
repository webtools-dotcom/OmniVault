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
          bg: "#0D1117",
          card: "#161B22",
          elevated: "#21262D",
          border: "#30363D",
          "border-active": "#58A6FF",
          primary: "#F0F6FC",
          secondary: "#8B949E",
          muted: "#6E7681",
          accent: "#2F81F7",
          "accent-hover": "#388BFD",
          success: "#238636",
          pending: "#D29922",
          error: "#F85149",
        }
      }
    },
  },
  plugins: [],
}
