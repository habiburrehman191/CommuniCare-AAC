/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        urdu: ['"Noto Nastaliq Urdu"', '"Noto Sans Arabic"', '"Jameel Noori Nastaleeq"', '"Urdu Typesetting"', 'serif'],
      },
      colors: {
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
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
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
        // Fitzgerald Key & Assistive AAC Semantic Palette
        aac: {
          yellow: {
            DEFAULT: "hsl(var(--aac-yellow))",
            bg: "hsl(var(--aac-yellow-bg))",
            border: "hsl(var(--aac-yellow-border))",
            fg: "hsl(var(--aac-yellow-fg))",
          },
          green: {
            DEFAULT: "hsl(var(--aac-green))",
            bg: "hsl(var(--aac-green-bg))",
            border: "hsl(var(--aac-green-border))",
            fg: "hsl(var(--aac-green-fg))",
          },
          blue: {
            DEFAULT: "hsl(var(--aac-blue))",
            bg: "hsl(var(--aac-blue-bg))",
            border: "hsl(var(--aac-blue-border))",
            fg: "hsl(var(--aac-blue-fg))",
          },
          orange: {
            DEFAULT: "hsl(var(--aac-orange))",
            bg: "hsl(var(--aac-orange-bg))",
            border: "hsl(var(--aac-orange-border))",
            fg: "hsl(var(--aac-orange-fg))",
          },
          purple: {
            DEFAULT: "hsl(var(--aac-purple))",
            bg: "hsl(var(--aac-purple-bg))",
            border: "hsl(var(--aac-purple-border))",
            fg: "hsl(var(--aac-purple-fg))",
          },
          red: {
            DEFAULT: "hsl(var(--aac-red))",
            bg: "hsl(var(--aac-red-bg))",
            border: "hsl(var(--aac-red-border))",
            fg: "hsl(var(--aac-red-fg))",
          },
        },
      },
      borderRadius: {
        '2xl': "calc(var(--radius) + 8px)",
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xs: "calc(var(--radius) - 6px)",
      },
      boxShadow: {
        'card-subtle': '0 1px 3px 0 rgb(0 0 0 / 0.04), 0 1px 2px -1px rgb(0 0 0 / 0.04)',
        'card-hover': '0 6px 16px -2px rgb(0 0 0 / 0.08), 0 3px 6px -2px rgb(0 0 0 / 0.04)',
        'card-active': '0 2px 4px 0 rgb(0 0 0 / 0.06)',
        'header-glass': '0 4px 20px -2px rgb(0 0 0 / 0.05)',
      },
      keyframes: {
        "pulse-subtle": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.85", transform: "scale(0.98)" },
        },
        "sound-wave": {
          "0%, 100%": { height: "6px" },
          "50%": { height: "20px" },
        },
      },
      animation: {
        "pulse-subtle": "pulse-subtle 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "sound-wave": "sound-wave 1s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};