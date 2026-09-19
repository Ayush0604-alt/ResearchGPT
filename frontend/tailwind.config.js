/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cream: {
          50: '#FDFBF7',
          100: '#F9F6F0',
          200: '#F2EBE1',
        },
        brand: {
          50: '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          300: '#fdba74',
          400: '#fb923c',
          500: '#f97316',
          // 600 and up are one step darker than Tailwind's orange so text and
          // white-on-brand buttons meet WCAG AA contrast (4.5:1).
          600: '#c2410c',
          700: '#9a3412',
          800: '#7c2d12',
          900: '#431407',
        },
        // Tailwind's gray-400 (2.5:1 on white) is used for secondary text here;
        // these keep that hierarchy at >= 4.5:1 on the page backgrounds.
        gray: {
          400: '#667085',
          500: '#555d6b',
        },
        espresso: {
          800: '#3D3531',
          900: '#2B2623',
        },
      },
      fontFamily: {
        sans: [
          '"Outfit"',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
      },
      boxShadow: {
        soft: '0 4px 20px -2px rgba(0, 0, 0, 0.05)',
        glow: '0 0 15px rgba(249, 115, 22, 0.4)',
      },
    },
  },
  plugins: [],
}
