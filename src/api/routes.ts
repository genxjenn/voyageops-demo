// src/api/routes.ts
import express from 'express';
import { db } from '../lib/couchbase.ts';

const router = express.Router();

// Health check endpoint
router.get('/health', async (req, res) => {
  try {
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      message: 'API server is running and Couchbase is connected' 
    });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({ status: 'error', error: String(error) });
  }
});

// API: KPIs
router.get('/dashboard/kpis', async (req, res) => {
  try {
    const q = `SELECT meta().id, k.* FROM voyageops.intelligence.kpis k`;
    const result = await db.cluster.query(q);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load KPIs' });
  }
});

// API: Guest by ID (with incidents)
router.get('/guests', async (req, res) => {
  try {
    const q = `SELECT g.* FROM voyageops.guests.guests g ORDER BY g.name ASC`;
    const result = await db.cluster.query(q);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load guests' });
  }
});

// API: Guest by ID (with incidents)
router.get('/guests/:id', async (req, res) => {
  try {
    const guestId = req.params.id;
    const guestDoc = await db.guests.get(guestId);
    const incidentsQ = `
      SELECT i.* FROM voyageops.guests.incidents i
      WHERE i.guestId = $guestId
      ORDER BY i.createdAt DESC`;
    const incidents = await db.cluster.query(incidentsQ, { parameters: { guestId } });
    res.json({ guest: guestDoc.value, incidents: incidents.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load guest' });
  }
});

// API: Incidents list
router.get('/incidents', async (req, res) => {
  try {
    const severity = req.query.severity;
    const status = req.query.status;
    const filterParts: string[] = [];
    const params: any = {};
    if (severity) { filterParts.push('i.severity = $severity'); params.severity = severity; }
    if (status) { filterParts.push('i.status = $status'); params.status = status; }

    const where = filterParts.length ? `WHERE ${filterParts.join(' AND ')}` : '';
    const q = `SELECT i.* FROM voyageops.guests.incidents i ${where} ORDER BY i.createdAt DESC`;
    const result = await db.cluster.query(q, { parameters: params });
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load incidents' });
  }
});

// API: Excursions
router.get('/excursions', async (req, res) => {
  try {
    const q = `SELECT e.* FROM voyageops.excursions.excursions e ORDER BY e.date DESC`;
    const result = await db.cluster.query(q);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load excursions' });
  }
});

// API: Venues
router.get('/venues', async (req, res) => {
  try {
    const q = `SELECT v.* FROM voyageops.operations.venues v ORDER BY v.currentOccupancy DESC`;
    const result = await db.cluster.query(q);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load venues' });
  }
});

// API: Recommendations
router.get('/recommendations', async (req, res) => {
  try {
    const agentType = req.query.agentType;
    const where = agentType ? 'WHERE r.agentType = $agentType' : '';
    const params = agentType ? { agentType } : {};
    const q = `SELECT r.* FROM voyageops.intelligence.recommendations r ${where} ORDER BY r.createdAt DESC`;
    const result = await db.cluster.query(q, { parameters: params });
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load recommendations' });
  }
});

// API: Recommendation state update
router.patch('/recommendations/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'status required' });

    await db.recommendations.mutateIn(id, [
      { type: 'replace', path: 'status', value: status },
      { type: 'replace', path: 'updatedAt', value: new Date().toISOString() },
    ]);
    const updated = await db.recommendations.get(id);
    res.json(updated.value);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update recommendation' });
  }
});

// API: Timeline
router.get('/timeline/:agentType', async (req, res) => {
  try {
    const agentType = req.params.agentType;
    const q = `
      SELECT t.* FROM voyageops.intelligence.timeline_events t
      WHERE t.agentType = $agentType
      ORDER BY t.timestamp DESC
    `;
    const result = await db.cluster.query(q, { parameters: { agentType } });
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load timeline' });
  }
});

// API: Ship info
router.get('/ship-info', async (req, res) => {
  try {
    const candidateKeys = ['ship_info::current', 'IOS-001'];

    for (const key of candidateKeys) {
      try {
        const doc = await db.shipInfo.get(key);
        return res.json(doc.value);
      } catch (readError) {
        if (!(readError instanceof Error) || !readError.message.includes('document not found')) {
          throw readError;
        }
      }
    }

    const fallbackQuery = `
      SELECT s.*
      FROM voyageops.intelligence.ship_info s
      LIMIT 1
    `;
    const fallbackResult = await db.cluster.query(fallbackQuery);

    if (fallbackResult.rows.length > 0) {
      return res.json(fallbackResult.rows[0]);
    }

    res.status(404).json({ error: 'ship info not found' });
  } catch (error) {
    if (error instanceof Error && error.message.includes('document not found')) {
      res.status(404).json({ error: 'ship info not found' });
    } else {
      console.error(error);
      res.status(500).json({ error: 'Failed to load ship info' });
    }
  }
});

export default router;
