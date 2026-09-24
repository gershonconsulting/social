import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    // v4.9.0 — "Charcoal & Signal Red". Geist for text, Geist Mono for numbers.
    fontFamily: {
      sans: ["Geist", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Helvetica Neue", "Arial", "sans-serif"],
      mono: ["Geist Mono", "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
    },
    extend: {
      colors: {
        // Warm neutrals replace Tailwind's cool grays everywhere at once, and
        // "red" becomes the Gershon signal red. Every page picks this up
        // without being edited.
        gray: {
          50: "#FAF9F6",
          100: "#F3F1EC",
          200: "#E6E3DC",
          300: "#D4D0C7",
          400: "#9A9DA5",
          500: "#6B7079",
          600: "#50545D",
          700: "#3D414A",
          800: "#2A2D34",
          900: "#15171C",
          950: "#0E0F12",
        },
        red: {
          50: "#FDF0EE",
          100: "#FBDCD8",
          200: "#F6BBB3",
          300: "#EF8E82",
          400: "#E65A4B",
          500: "#DF3B2B",
          600: "#D92D20",
          700: "#B42318",
          800: "#8A1C12",
          900: "#6B170F",
        },
        brand: {
          DEFAULT: "#D92D20",
          hover: "#B42318",
          charcoal: "#111317",
          ink: "#15171C",
          paper: "#F5F4F0",
          stone: "#E3E0D8",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        status: {
          green: "#16a34a",
          red: "#dc2626",
          yellow: "#d97706",
          gray: "#6b7280",
        },
      },
      // Flat cards: a hairline border does the work, not a shadow.
      boxShadow: {
        sm: "0 1px 2px rgba(21, 23, 28, 0.04)",
        DEFAULT: "0 1px 3px rgba(21, 23, 28, 0.06)",
        md: "0 4px 12px rgba(21, 23, 28, 0.08)",
        lg: "0 12px 32px rgba(21, 23, 28, 0.12)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
