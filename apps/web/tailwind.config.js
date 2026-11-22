/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#f2f5fa', 100: '#e3eaf4', 200: '#c3d1e6', 300: '#93a9cd',
          400: '#5c7bad', 500: '#3b5c92', 600: '#2b4675', 700: '#1f3559',
          800: '#16273f', 900: '#0e1b2d', 950: '#080f19',
        },
        accent: { DEFAULT: '#2563eb', hover: '#1d4ed8', soft: '#eff4ff' },
        canvas: '#f6f7f9',
        edge: '#e3e6ea',
        ink: { DEFAULT: '#1a1f2b', muted: '#5b6472', faint: '#8a929f' },
        ok: '#12805c',
        warn: '#b45309',
        danger: '#c0362c',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: { card: '0 1px 2px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.04)', pop: '0 8px 24px rgba(16,24,40,0.12)' },
      borderRadius: { xl: '0.75rem' },
      keyframes: {
        'fade-in': { from: { opacity: 0, transform: 'translateY(4px)' }, to: { opacity: 1, transform: 'none' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: { 'fade-in': 'fade-in 0.18s ease-out', shimmer: 'shimmer 1.4s infinite' },
    },
  },
  plugins: [],
};
