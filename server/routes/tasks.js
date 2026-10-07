const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const syncBus = require('../syncBus');

// All task routes require authentication
router.use(requireAuth);

// GET /api/tasks - Retrieve all tasks for current user
router.get('/', (req, res) => {
  try {
    const tasks = db.prepare(`
      SELECT id, name, pts, type, date, created_at 
      FROM tasks 
      WHERE user_id = ? 
      ORDER BY created_at ASC
    `).all(req.user.id);

    res.json({ tasks });
  } catch (err) {
    console.error('Error fetching tasks:', err);
    res.status(500).json({ error: 'Failed to fetch tasks.' });
  }
});

// POST /api/tasks - Create a new task
router.post('/', (req, res) => {
  try {
    const { name, pts, type, date, id } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Task name is required and must be text.' });
    }

    const cleanName = name.trim().slice(0, 150);

    const points = Number(pts);
    if (!Number.isFinite(points) || points <= 0 || points > 1000) {
      return res.status(400).json({ error: 'Points must be a positive number between 0.1 and 1000.' });
    }

    const taskType = type === 'neg' ? 'neg' : 'pos';

    let taskId;
    if (id) {
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_\-]{3,64}$/.test(id)) {
        return res.status(400).json({ error: 'Invalid task ID format.' });
      }
      taskId = id;
    } else {
      taskId = 't' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    }

    let taskDate = null;
    if (date) {
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'Invalid date format. Expected YYYY-MM-DD.' });
      }
      taskDate = date;
    }

    db.prepare(`
      INSERT INTO tasks (id, user_id, name, pts, type, date)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(taskId, req.user.id, cleanName, points, taskType, taskDate);

    const newTask = {
      id: taskId,
      name: cleanName,
      pts: points,
      type: taskType,
      date: taskDate
    };

    // Broadcast in real-time to all other devices for this user
    syncBus.broadcast(req.user.id, 'TASK_CREATED', { task: newTask });

    res.status(201).json({ success: true, task: newTask });
  } catch (err) {
    console.error('Error creating task:', err);
    res.status(500).json({ error: 'Failed to create task.' });
  }
});

// PUT /api/tasks/:id - Update existing task name and points
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, pts } = req.body;

    if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9_\-]{3,64}$/.test(id)) {
      return res.status(400).json({ error: 'Invalid task ID.' });
    }

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Task name is required and must be text.' });
    }

    const cleanName = name.trim().slice(0, 150);

    const points = Number(pts);
    if (!Number.isFinite(points) || points <= 0 || points > 1000) {
      return res.status(400).json({ error: 'Points must be a positive number between 0.1 and 1000.' });
    }

    const existing = db.prepare('SELECT id FROM tasks WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!existing) {
      return res.status(404).json({ error: 'Task not found.' });
    }

    db.prepare(`
      UPDATE tasks 
      SET name = ?, pts = ? 
      WHERE id = ? AND user_id = ?
    `).run(cleanName, points, id, req.user.id);

    const updatedTask = { id, name: cleanName, pts: points };

    // Broadcast in real-time to all other devices for this user
    syncBus.broadcast(req.user.id, 'TASK_UPDATED', { task: updatedTask });

    res.json({
      success: true,
      task: updatedTask
    });
  } catch (err) {
    console.error('Error updating task:', err);
    res.status(500).json({ error: 'Failed to update task.' });
  }
});

// DELETE /api/tasks/:id - Delete a task and its history
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9_\-]{3,64}$/.test(id)) {
      return res.status(400).json({ error: 'Invalid task ID.' });
    }

    const existing = db.prepare('SELECT id FROM tasks WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!existing) {
      return res.status(404).json({ error: 'Task not found.' });
    }

    // Delete associated history records
    db.prepare('DELETE FROM history WHERE task_id = ? AND user_id = ?').run(id, req.user.id);
    // Delete task
    db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').run(id, req.user.id);

    // Broadcast in real-time to all other devices for this user
    syncBus.broadcast(req.user.id, 'TASK_DELETED', { id });

    res.json({ success: true, message: 'Task deleted successfully.' });
  } catch (err) {
    console.error('Error deleting task:', err);
    res.status(500).json({ error: 'Failed to delete task.' });
  }
});

module.exports = router;
