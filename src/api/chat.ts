// src/api/chat.ts (or add to router)
import express from 'express';
const router = express.Router();

router.post('/api/chat', async (req, res) => {
  try {
    // replace this with Capella AI vector search + RAG logic
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt required' });

    const message = `AI response placeholder for: ${prompt}`;
    res.json({ message, source: 'mock' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Chat error' });
  }
});

export default router;
