import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    // Geist for text, Geist Mono for numbers (kept from v4.9.0).
    fontFamily: {
      sans: ["Geist", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Helvetica Neue", "Arial", "sans-serif"],
      mono: ["Geist Mono", "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
    },
    extend: {
      colors: {
        // v4.66.0 — unified Gershon design (Linalysis layout, Gershon.ai red).
        // Neutral greys (text #1d1d1f, borders #e5e7eb) and "red" = Gershon red
        // #CC3333 (600) / #a8281f (700) / tint #fdf2f2 (50). Every page picks
        // this up without being edited. Status colours (green / amber) are
        // untouched; status red stays a clearly-red red.
        gray: {
          50: "#FAFAFA",
          100: "#F3F4F6",
          200: "#E5E7EB",
          300: "#D1D5DB",
          400: "#9CA3AF",
          500: "#6E6E73",
          600: "#4B5563",
          700: "#374151",
          800: "#2A2A2E",
          900: "#1D1D1F",
          950: "#111113",
        },
        red: {
          50: "#FDF2F2",
          100: "#FBE1E1",
          200: "#F3CACA",
          300: "#EC9F9F",
          400: "#E06B6B",
          500: "#D64545",
          600: "#CC3333",
          700: "#A8281F",
          800: "#86201A",
          900: "#6B1A15",
        },
        brand: {
          DEFAULT: "#CC3333",
          hover: "#A8281F",
          tint: "#FDF2F2",
          charcoal: "#1D1D1F",
          ink: "#1D1D1F",
          paper: "#FAFAFA",
          stone: "#E5E7EB",
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
