// server.ts
import express from 'express';
import routes from './routes.ts';
import dotenv from 'dotenv';
import { initCouchbase } from '../lib/couchbase.ts';

dotenv.config({ path: '.env' }); // Load .env specifically

async function startServer() {
  try {
    // Initialize Couchbase connection
    await initCouchbase();
    console.log('✅ Connected to Couchbase Capella');

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
