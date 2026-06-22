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
        // Legacy class prefix (am-*) — values mapped to OrgSight blue
        am: {
          50:  "#eaf3ff",
          100: "#dbeafe",
          200: "#74a9e7",
          300: "#5a93d5",
          400: "#315f9b",
          500: "#155bb2", // primary
          600: "#0a3f86",
          700: "#0f2e5c",
          800: "#0f172a",
          900: "#0a1628",
          deep: "#0a3f86",
          teal: "#14b8a6",
        },
        brand: {
          50:  "#eaf3ff",
          100: "#dbeafe",
          200: "#74a9e7",
          300: "#5a93d5",
          400: "#315f9b",
          500: "#155bb2",
          600: "#0a3f86",
          700: "#0f2e5c",
          800: "#0f172a",
        },
      },
    },
  },
  plugins: [],
}
