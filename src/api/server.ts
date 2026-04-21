// server.ts
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { initCouchbase, db } from '../lib/couchbase.ts';

const serverFile = fileURLToPath(import.meta.url);
const serverDir = path.dirname(serverFile);
const defaultEnvPath = path.resolve(serverDir, '../../.env');

// Prefer explicit DOTENV_CONFIG_PATH when set; otherwise always load repo-root .env.
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || defaultEnvPath, quiet: true });

async function startServer() {
  try {
    // Initialize Couchbase connection
    await initCouchbase();
    console.log('✅ Connected to Couchbase Capella');
    const { default: routes } = await import('./routes.ts');

    const app = express();
    const port = Number(process.env.PORT || 5173);

    app.use(express.json());

    // CORS for direct cross-port frontend calls
    app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
      }
      next();
    });

    app.use('/api', routes);      // all API endpoints under /api

    // Safety fallback endpoint for action proposals.
    // This keeps the UI working even when a dev server hot-reload misses a route update.
    app.get('/api/action-proposals', async (req, res) => {
      try {
        const guestId = req.query.guestId as string | undefined;
        const incidentId = req.query.incidentId as string | undefined;
        const runFilterParts: string[] = ['r.proposalId IS NOT MISSING'];
        const runParams: any = {};

        if (guestId) {
          runFilterParts.push('r.guestId = $guestId');
          runParams.guestId = guestId;
        }
        if (incidentId) {
          runFilterParts.push('r.incidentId = $incidentId');
          runParams.incidentId = incidentId;
        }

        const runsQuery = `
          SELECT r.proposalId, r.updatedAt
          FROM voyageops.agent.agent_runs r
          WHERE ${runFilterParts.join(' AND ')}
          ORDER BY r.updatedAt DESC
          LIMIT 100
        `;

        const runsResult = await db.cluster.query(runsQuery, { parameters: runParams, timeout: 10000 });
        const proposalIds = Array.from(
          new Set(
            (runsResult.rows as any[])
              .map((row) => String(row.proposalId || '').trim())
              .filter(Boolean),
          ),
        ).slice(0, 50);

        const fetched = await Promise.allSettled(
          proposalIds.map(async (proposalId) => {
            const doc = await db.actionProposals.get(proposalId);
            return { _key: proposalId, ...(doc.content as Record<string, unknown>) };
          }),
        );

        const proposals = fetched
          .flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
          .sort((a, b) => String((b as any).createdAt || '').localeCompare(String((a as any).createdAt || '')));

        res.json(proposals);
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to load action proposals' });
      }
    });

    app.get('/api/_routes', (req, res) => {
      const appRouter = (app as any)?._router;
      const stack = Array.isArray(appRouter?.stack) ? appRouter.stack : [];
      const routes = stack
        .filter((layer: any) => layer?.route?.path)
        .map((layer: any) => {
          const methods = Object.keys(layer.route.methods || {}).filter((m) => layer.route.methods[m]);
          return { path: layer.route.path, methods };
        });
      res.json(routes);
    });

    app.use((err, req, res, next) => {
      console.error(err);
      res.status(500).json({ error: 'Internal Server Error' });
    });

    app.listen(port, () => {
      console.log(`🚀 API server listening at http://localhost:${port}`);
    });

    // Keep the process alive
    setInterval(() => {}, 1000);
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
