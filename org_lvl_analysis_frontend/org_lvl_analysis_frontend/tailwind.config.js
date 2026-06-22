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
        // A&M brand palette
        am: {
          50:  "#e6f3f1",
          100: "#c2e1dc",
          200: "#8ec6bd",
          300: "#5aab9e",
          400: "#2e9180",
          500: "#0D6B5F", // primary
          600: "#0a5549",
          700: "#084037",
          800: "#062c26",
          900: "#031815",
          deep: "#0A3D4F",
          teal: "#1a8a7d",
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
