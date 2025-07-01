const express = require('express');
const db = require('../config/database');
const auth = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Get user dashboard statistics
router.get('/dashboard', auth, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get document statistics
    const documentStats = await db.query(
      `SELECT 
        COUNT(*) as total_documents,
        SUM(file_size) as total_size,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN 1 END) as recent_documents
       FROM documents 
       WHERE user_id = $1`,
      [userId]
    );

    // Get analysis statistics
    const analysisStats = await db.query(
      `SELECT 
        COUNT(*) as total_analyses,
        COUNT(CASE WHEN a.created_at >= NOW() - INTERVAL '7