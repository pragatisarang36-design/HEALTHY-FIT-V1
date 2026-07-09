import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
    resolve: {
      alias: {
        '@': path.resolve(process.cwd(), 'src'),
      },
    },
    plugins: [
      react(),
    ],
    server: {
      port: 3000,
    },
    build: {
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        output: {
          manualChunks(id) {
            // The local generated exercise fallback (~982KB) is already only reached via
            // dynamic import() in workoutExerciseService.js when Supabase is unavailable --
            // give it its own named chunk so it's never pulled into the main bundle and only
            // downloads for the users who actually hit the fallback path.
            if (id.includes('src/data/generatedExerciseDatabase') || id.includes('src/data/localExerciseDatabase')) {
              return 'workout-exercise-fallback';
            }
            if (id.includes('node_modules')) {
              // Split only the heaviest independent libraries. Let Rollup keep the rest
              // together so packages that import React don't form circular manual chunks.
              if (id.includes('recharts') || id.includes('d3-')) return 'vendor-charts';
              if (id.includes('@supabase')) return 'vendor-supabase';
              if (id.includes('date-fns')) return 'vendor-date-fns';
            }
          },
        },
      },
    },
});
