const express = require('express');
const multer = require('multer');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const auth = require('../middleware/auth');
const { extractText } = require('../utils/documentProcessor');
const { analyzeWithAI } = require('../utils/aiProcessor');
const logger = require('../utils/logger');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/markdown'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Please upload PDF, Word, or text files.'), false);
    }
  }
});

// Upload and analyze document
router.post('/upload', auth, upload.single('document'), [
  body('aiProvider').isIn(['claude', 'openai', 'gemini']).withMessage('Invalid AI provider'),
  body('analysisType').optional().isIn(['security-review', 'policy-analysis', 'compliance-check', 'general']).withMessage('Invalid analysis type'),
  body('customPrompt').optional().isLength({ max: 1000 }).withMessage('Custom prompt too long')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: 'No file uploaded',
        message: 'Please select a file to upload'
      });
    }

    const { aiProvider, analysisType = 'general', customPrompt } = req.body;
    const file = req.file;

    logger.info(`Processing document upload for user ${req.user.userId}: ${file.originalname}`);

    // Extract text from document
    const extractedText = await extractText(file);
    
    if (!extractedText || extractedText.trim().length === 0) {
      return res.status(400).json({
        error: 'Cannot extract text',
        message: 'Unable to extract readable text from the uploaded document'
      });
    }

    // Save document to database
    const documentResult = await db.query(
      `INSERT INTO documents (user_id, filename, file_size, mime_type, content, created_at) 
       VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING id`,
      [req.user.userId, file.originalname, file.size, file.mimetype, extractedText]
    );

    const documentId = documentResult.rows[0].id;

    // Analyze with AI
    const analysis = await analyzeWithAI(extractedText, aiProvider, analysisType, customPrompt);

    // Save analysis result
    await db.query(
      `INSERT INTO analyses (document_id, user_id, ai_provider, analysis_type, custom_prompt, result, created_at) 
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [documentId, req.user.userId, aiProvider, analysisType, customPrompt, JSON.stringify(analysis)]
    );

    logger.info(`Document analysis completed for user ${req.user.userId}, document ${documentId}`);

    res.json({
      message: 'Document analyzed successfully',
      documentId: documentId,
      filename: file.originalname,
      analysis: analysis,
      metadata: {
        fileSize: file.size,
        aiProvider: aiProvider,
        analysisType: analysisType,
        processingTime: analysis.processingTime || 'N/A'
      }
    });

  } catch (error) {
    logger.error('Document upload/analysis error:', error);
    
    if (error.message.includes('Invalid file type')) {
      return res.status(400).json({
        error: 'Invalid file type',
        message: error.message
      });
    }

    if (error.message.includes('AI service')) {
      return res.status(503).json({
        error: 'AI service unavailable',
        message: 'The selected AI service is currently unavailable. Please try again later or select a different provider.'
      });
    }

    res.status(500).json({
      error: 'Processing failed',
      message: 'An error occurred while processing your document'
    });
  }
});

// Get user's documents
router.get('/', auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const result = await db.query(
      `SELECT d.id, d.filename, d.file_size, d.mime_type, d.created_at,
              COUNT(a.id) as analysis_count,
              MAX(a.created_at) as last_analysis
       FROM documents d
       LEFT JOIN analyses a ON d.id = a.document_id
       WHERE d.user_id = $1
       GROUP BY d.id, d.filename, d.file_size, d.mime_type, d.created_at
       ORDER BY d.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.userId, limit, offset]
    );

    const countResult = await db.query(
      'SELECT COUNT(*) FROM documents WHERE user_id = $1',
      [req.user.userId]
    );

    const totalDocuments = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalDocuments / limit);

    res.json({
      documents: result.rows,
      pagination: {
        currentPage: page,
        totalPages: totalPages,
        totalDocuments: totalDocuments,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });

  } catch (error) {
    logger.error('Failed to fetch documents:', error);
    res.status(500).json({
      error: 'Failed to fetch documents',
      message: 'An error occurred while retrieving your documents'
    });
  }
});

// Get specific document details
router.get('/:id', auth, async (req, res) => {
  try {
    const documentId = req.params.id;

    const result = await db.query(
      `SELECT d.*, 
              json_agg(
                json_build_object(
                  'id', a.id,
                  'ai_provider', a.ai_provider,
                  'analysis_type', a.analysis_type,
                  'custom_prompt', a.custom_prompt,
                  'result', a.result,
                  'created_at', a.created_at
                ) ORDER BY a.created_at DESC
              ) FILTER (WHERE a.id IS NOT NULL) as analyses
       FROM documents d
       LEFT JOIN analyses a ON d.id = a.document_id
       WHERE d.id = $1 AND d.user_id = $2
       GROUP BY d.id`,
      [documentId, req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Document not found',
        message: 'The requested document does not exist or you do not have access to it'
      });
    }

    const document = result.rows[0];

    res.json({
      document: {
        id: document.id,
        filename: document.filename,
        fileSize: document.file_size,
        mimeType: document.mime_type,
        content: document.content,
        createdAt: document.created_at,
        analyses: document.analyses || []
      }
    });

  } catch (error) {
    logger.error('Failed to fetch document details:', error);
    res.status(500).json({
      error: 'Failed to fetch document',
      message: 'An error occurred while retrieving the document details'
    });
  }
});

// Delete document
router.delete('/:id', auth, async (req, res) => {
  try {
    const documentId = req.params.id;

    // Check if document exists and belongs to user
    const docCheck = await db.query(
      'SELECT id FROM documents WHERE id = $1 AND user_id = $2',
      [documentId, req.user.userId]
    );

    if (docCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'Document not found',
        message: 'The requested document does not exist or you do not have access to it'
      });
    }

    // Delete analyses first (foreign key constraint)
    await db.query('DELETE FROM analyses WHERE document_id = $1', [documentId]);

    // Delete document
    await db.query('DELETE FROM documents WHERE id = $1', [documentId]);

    logger.info(`Document deleted: ${documentId} by user ${req.user.userId}`);

    res.json({
      message: 'Document deleted successfully',
      documentId: documentId
    });

  } catch (error) {
    logger.error('Failed to delete document:', error);
    res.status(500).json({
      error: 'Failed to delete document',
      message: 'An error occurred while deleting the document'
    });
  }
});

module.exports = router;