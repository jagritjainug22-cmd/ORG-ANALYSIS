/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
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
          deep: "#0A3D4F", // dark accent for branding panel
          teal: "#1a8a7d", // lighter accent
        },
      },
    },
  },
  plugins: [],
}
