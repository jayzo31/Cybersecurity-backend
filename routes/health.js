const express = require('express');
const db = require('../config/database');
const { checkServiceAvailability } = require('../utils/aiProcessor');
const logger = require('../utils/logger');

const router = express.Router();

// Basic health check
router.get('/', async (req, res) => {
  try {
    const healthCheck = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      version: '2.0.0',
      services: {
        database: 'checking...',
        ai_providers: {
          claude: 'checking...',
          openai: 'checking...',
          gemini: 'checking...'
        }
      },
      system: {
        memory: {
          used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
          external: Math.round(process.memoryUsage().external / 1024 / 1024)
        },
        cpu: process.cpuUsage(),
        nodeVersion: process.version
      }
    };

    // Check database connection
    try {
      const dbHealth = await db.healthCheck();
      healthCheck.services.database = dbHealth;
    } catch (error) {
      healthCheck.services.database = {
        status: 'unhealthy',
        error: error.message
      };
      healthCheck.status = 'degraded';
    }

    // Check AI service availability
    try {
      healthCheck.services.ai_providers.claude = await checkServiceAvailability('claude') ? 'available' : 'not configured';
      healthCheck.services.ai_providers.openai = await checkServiceAvailability('openai') ? 'available' : 'not configured';
      healthCheck.services.ai_providers.gemini = await checkServiceAvailability('gemini') ? 'available' : 'not configured';
    } catch (error) {
      logger.warn('AI service check failed:', error);
      healthCheck.services.ai_providers = {
        error: 'Failed to check AI services'
      };
    }

    // Determine overall status
    if (healthCheck.services.database.status === 'unhealthy') {
      healthCheck.status = 'unhealthy';
      return res.status(503).json(healthCheck);
    }

    const availableAI = Object.values(healthCheck.services.ai_providers)
      .filter(status => status === 'available').length;

    if (availableAI === 0) {
      healthCheck.status = 'degraded';
      healthCheck.warning = 'No AI services configured';
    }

    const statusCode = healthCheck.status === 'healthy' ? 200 : 
                      healthCheck.status === 'degraded' ? 200 : 503;

    res.status(statusCode).json(healthCheck);

  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
      message: error.message
    });
  }
});

// Readiness probe (for Kubernetes/Railway)
router.get('/ready', async (req, res) => {
  try {
    // Quick database ping
    await db.query('SELECT 1');
    
    res.status(200).json({
      status: 'ready',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Liveness probe (for Kubernetes/Railway)
router.get('/live', (req, res) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

module.exports = router;