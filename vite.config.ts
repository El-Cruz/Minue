import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  for (const name of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'APP_URL']) {
    if (env[name]) process.env[name] = env[name];
  }
  return {
    plugins: [react(), {
      name: 'minue-local-api',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const path = req.url?.split('?')[0];
          if (path !== '/api/command' && path !== '/api/receipt') return next();
          try {
            const module = await server.ssrLoadModule(`${path}.ts`);
            await module.default(req, res);
          } catch {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'No se pudo completar la solicitud.' }));
          }
        });
      },
    }],
    server: { host: '0.0.0.0', port: 5173 },
    preview: { host: '0.0.0.0', port: 4173 },
    build: { target: 'es2022' },
  };
});
