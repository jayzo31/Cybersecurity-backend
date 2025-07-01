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
        COUNT(CASE WHEN a.created_at >= NOW() - INTERVAL '7 days' THEN 1 END) as recent_analyses,
        json_object_agg(a.ai_provider, a.count) as provider_usage
       FROM (
         SELECT ai_provider, COUNT(*) as count
         FROM analyses
         WHERE user_id = $1
         GROUP BY ai_provider
       ) a`,
      [userId]
    );

    // Get recent activity
    const recentActivity = await db.query(
      `SELECT 'document' as type, id, filename as title, created_at 
       FROM documents 
       WHERE user_id = $1
       UNION ALL
       SELECT 'analysis' as type, a.id, d.filename || ' (' || a.analysis_type || ')' as title, a.created_at
       FROM analyses a
       JOIN documents d ON a.document_id = d.id
       WHERE a.user_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [userId]
    );

    res.json({
      stats: {
        documents: {
          total: parseInt(documentStats.rows[0].total_documents) || 0,
          totalSize: parseInt(documentStats.rows[0].total_size) || 0,
          recent: parseInt(documentStats.rows[0].recent_documents) || 0
        },
        analyses: {
          total: parseInt(analysisStats.rows[0].total_analyses) || 0,
          recent: parseInt(analysisStats.rows[0].recent_analyses) || 0,
          providerUsage: analysisStats.rows[0].provider_usage || {}
        }
      },
      recentActivity: recentActivity.rows
    });

  } catch (error) {
    logger.error('Failed to fetch dashboard data:', error);
    res.status(500).json({
      error: 'Failed to fetch dashboard data',
      message: 'An error occurred while retrieving dashboard statistics'
    });
  }
});

module.exports = router;