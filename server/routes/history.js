const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const syncBus = require('../syncBus');

// All history routes require authentication
router.use(requireAuth);

// GET /api/history - Retrieve all completion checkmarks grouped by date
router.get('/', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT task_id, date 
      FROM history 
      WHERE user_id = ?
    `).all(req.user.id);

    const historyMap = {};
    for (const row of rows) {
      if (!historyMap[row.date]) {
        historyMap[row.date] = [];
      }
      historyMap[row.date].push(row.task_id);
    }

    res.json({ history: historyMap });
  } catch (err) {
    console.error('Error fetching history:', err);
    res.status(500).json({ error: 'Failed to fetch history.' });
  }
});

// POST /api/history/toggle - Toggle checkmark on/off for a task on a specific date
router.post('/toggle', (req, res) => {
  try {
    const { taskId, date } = req.body;

    if (!taskId || !date || typeof taskId !== 'string' || typeof date !== 'string') {
      return res.status(400).json({ error: 'Valid taskId and date are required.' });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Date must be formatted as YYYY-MM-DD.' });
    }

    // IDOR Protection: Ensure task belongs to the authenticated user
    const taskOwner = db.prepare('SELECT id FROM tasks WHERE id = ? AND user_id = ?').get(taskId, req.user.id);
    if (!taskOwner) {
      return res.status(404).json({ error: 'Task not found or access denied.' });
    }

    const existing = db.prepare(`
      SELECT id FROM history 
      WHERE user_id = ? AND task_id = ? AND date = ?
    `).get(req.user.id, taskId, date);

    let isChecked = false;

    if (existing) {
      db.prepare(`
        DELETE FROM history 
        WHERE user_id = ? AND task_id = ? AND date = ?
      `).run(req.user.id, taskId, date);
      isChecked = false;
    } else {
      db.prepare(`
        INSERT INTO history (user_id, task_id, date)
        VALUES (?, ?, ?)
      `).run(req.user.id, taskId, date);
      isChecked = true;
    }

    // Broadcast change to other devices in real-time
    syncBus.broadcast(req.user.id, 'TASK_TOGGLED', {
      taskId,
      date,
      checked: isChecked
    });

    return res.json({ success: true, checked: isChecked });
  } catch (err) {
    console.error('Error toggling history:', err);
    res.status(500).json({ error: 'Failed to toggle task history.' });
  }
});

// POST /api/history/import - Import legacy ProTrackR tasks and history JSON into DB
router.post('/import', (req, res) => {
  try {
    const { tasks, history } = req.body;

    if (!Array.isArray(tasks) && !history) {
      return res.status(400).json({ error: 'Invalid import format. Expected { tasks, history }.' });
    }

    const insertTask = db.prepare(`
      INSERT OR REPLACE INTO tasks (id, user_id, name, pts, type, date)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertHistory = db.prepare(`
      INSERT OR IGNORE INTO history (user_id, task_id, date)
      VALUES (?, ?, ?)
    `);

    const importTransaction = db.transaction(() => {
      if (Array.isArray(tasks)) {
        for (const t of tasks) {
          if (t.name && t.pts) {
            insertTask.run(
              t.id || ('t' + Date.now() + '_' + Math.random().toString(36).substr(2, 4)),
              req.user.id,
              t.name,
              parseFloat(t.pts),
              t.type === 'neg' ? 'neg' : 'pos',
              t.date || null
            );
          }
        }
      }

      if (history && typeof history === 'object') {
        for (const [d, taskIds] of Object.entries(history)) {
          if (Array.isArray(taskIds)) {
            for (const tId of taskIds) {
              insertHistory.run(req.user.id, tId, d);
            }
          }
        }
      }
    });

    importTransaction();

    // Broadcast full data refresh to other devices
    syncBus.broadcast(req.user.id, 'DATA_IMPORTED', {});

    res.json({ success: true, message: 'Data imported successfully into database.' });
  } catch (err) {
    console.error('Error importing data:', err);
    res.status(500).json({ error: 'Failed to import data.' });
  }
});

module.exports = router;
