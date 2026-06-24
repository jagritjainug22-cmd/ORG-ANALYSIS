/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Avenir', 'Helvetica', 'Arial', 'sans-serif'],
      },
      colors: {
        // Legacy class prefix (am-*) — aligned with admin panel navy palette
        am: {
          50:  "#e8eef5",
          100: "#dce4ee",
          200: "#74a9e7",
          300: "#5a93d5",
          400: "#315f9b",
          500: "#0a3f86", // primary buttons, active nav
          600: "#01244a", // headers, dark surfaces
          700: "#08304a", // borders, hover
          800: "#0f172a",
          900: "#0a1628",
          deep: "#01244a",
          teal: "#14b8a6",
        },
        brand: {
          50:  "#e8eef5",
          100: "#dce4ee",
          200: "#74a9e7",
          300: "#5a93d5",
          400: "#315f9b",
          500: "#0a3f86", // primary buttons, active sidebar
          600: "#01244a", // app headers
          700: "#08304a", // header borders, pressed states
          800: "#0f172a",
        },
      },
      keyframes: {
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%":       { opacity: "0" },
        },
      },
      animation: {
        blink: "blink 1s step-end infinite",
      },
    },
  },
  plugins: [],
}
