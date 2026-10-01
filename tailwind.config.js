/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        wg: {
          bg: "rgb(var(--wg-bg) / <alpha-value>)",
          surface: "rgb(var(--wg-surface) / <alpha-value>)",
          raised: "rgb(var(--wg-raised) / <alpha-value>)",
          inset: "rgb(var(--wg-inset) / <alpha-value>)",

          border: "rgb(var(--wg-border) / <alpha-value>)",
          "border-strong": "rgb(var(--wg-border-strong) / <alpha-value>)",

          text: "rgb(var(--wg-text) / <alpha-value>)",
          secondary: "rgb(var(--wg-secondary) / <alpha-value>)",
          muted: "rgb(var(--wg-muted) / <alpha-value>)",

          accent: "rgb(var(--wg-accent) / <alpha-value>)",
          success: "rgb(var(--wg-success) / <alpha-value>)",
          warning: "rgb(var(--wg-warning) / <alpha-value>)",
          danger: "rgb(var(--wg-danger) / <alpha-value>)",
          "success-soft": "rgb(var(--wg-success-soft) / <alpha-value>)",
          "warning-soft": "rgb(var(--wg-warning-soft) / <alpha-value>)",
          "danger-soft": "rgb(var(--wg-danger-soft) / <alpha-value>)",
        },
      },
    },
  },
  plugins: [],
};