const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const logger = require('./logger');

// Extract text from different file types
const extractText = async (file) => {
  try {
    const { buffer, mimetype, originalname } = file;
    
    logger.info(`Extracting text from ${originalname} (${mimetype})`);

    switch (mimetype) {
      case 'application/pdf':
        return await extractFromPDF(buffer);
      
      case 'application/msword':
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        return await extractFromWord(buffer);
      
      case 'text/plain':
      case 'text/markdown':
        return buffer.toString('utf-8');
      
      default:
        throw new Error(`Unsupported file type: ${mimetype}`);
    }

  } catch (error) {
    logger.error('Text extraction error:', error);
    throw new Error(`Failed to extract text: ${error.message}`);
  }
};

// Extract text from PDF files
const extractFromPDF = async (buffer) => {
  try {
    const data = await pdfParse(buffer);
    const text = data.text.trim();
    
    if (!text || text.length === 0) {
      throw new Error('PDF appears to be empty or contains no readable text');
    }

    // Clean up the extracted text
    const cleanedText = cleanExtractedText(text);
    
    logger.info(`Extracted ${cleanedText.length} characters from PDF`);
    return cleanedText;

  } catch (error) {
    logger.error('PDF extraction error:', error);
    throw new Error(`Failed to extract text from PDF: ${error.message}`);
  }
};

// Extract text from Word documents
const extractFromWord = async (buffer) => {
  try {
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value.trim();
    
    if (!text || text.length === 0) {
      throw new Error('Word document appears to be empty or contains no readable text');
    }

    // Clean up the extracted text
    const cleanedText = cleanExtractedText(text);
    
    logger.info(`Extracted ${cleanedText.length} characters from Word document`);
    return cleanedText;

  } catch (error) {
    logger.error('Word extraction error:', error);
    throw new Error(`Failed to extract text from Word document: ${error.message}`);
  }
};

// Clean and normalize extracted text
const cleanExtractedText = (text) => {
  if (!text) return '';
  
  return text
    // Remove excessive whitespace
    .replace(/\s+/g, ' ')
    // Remove multiple line breaks
    .replace(/\n\s*\n/g, '\n\n')
    // Remove special characters that might interfere with AI processing
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
    // Trim whitespace
    .trim();
};

// Validate file before processing
const validateFile = (file) => {
  const errors = [];
  
  if (!file) {
    errors.push('No file provided');
    return errors;
  }

  // Check file size (50MB limit)
  const maxSize = 50 * 1024 * 1024;
  if (file.size > maxSize) {
    errors.push(`File size (${(file.size / 1024 / 1024).toFixed(2)}MB) exceeds maximum limit of 50MB`);
  }

  // Check file type
  const allowedTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown'
  ];

  if (!allowedTypes.includes(file.mimetype)) {
    errors.push(`File type ${file.mimetype} is not supported. Allowed types: PDF, Word, Text, Markdown`);
  }

  // Check filename
  if (!file.originalname || file.originalname.trim().length === 0) {
    errors.push('File must have a valid filename');
  }

  return errors;
};

// Get file metadata
const getFileMetadata = (file) => {
  return {
    filename: file.originalname,
    size: file.size,
    sizeFormatted: formatFileSize(file.size),
    mimetype: file.mimetype,
    extension: getFileExtension(file.originalname),
    uploadTimestamp: new Date().toISOString()
  };
};

// Format file size for display
const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Get file extension
const getFileExtension = (filename) => {
  if (!filename || typeof filename !== 'string') return '';
  return filename.split('.').pop().toLowerCase();
};

// Process document and prepare for analysis
const processDocument = async (file) => {
  try {
    // Validate file first
    const validationErrors = validateFile(file);
    if (validationErrors.length > 0) {
      throw new Error(`File validation failed: ${validationErrors.join(', ')}`);
    }

    // Get file metadata
    const metadata = getFileMetadata(file);
    
    // Extract text content
    const content = await extractText(file);
    
    // Validate extracted content
    if (!content || content.trim().length === 0) {
      throw new Error('No readable text content found in the document');
    }

    if (content.length < 50) {
      throw new Error('Document content is too short for meaningful analysis (minimum 50 characters required)');
    }

    // Additional content analysis
    const contentAnalysis = analyzeContent(content);
    
    logger.info(`Document processed successfully: ${metadata.filename}`);
    
    return {
      metadata,
      content,
      contentAnalysis,
      processingTimestamp: new Date().toISOString()
    };

  } catch (error) {
    logger.error('Document processing error:', error);
    throw error;
  }
};

// Analyze content characteristics
const analyzeContent = (content) => {
  const analysis = {
    length: content.length,
    wordCount: content.split(/\s+/).length,
    lineCount: content.split('\n').length,
    hasSecurityKeywords: false,
    securityKeywords: [],
    estimatedReadingTime: 0
  };

  // Security-related keywords to look for
  const securityKeywords = [
    'security', 'cybersecurity', 'vulnerability', 'threat', 'risk', 'compliance',
    'encryption', 'authentication', 'authorization', 'firewall', 'malware',
    'phishing', 'breach', 'incident', 'policy', 'procedure', 'audit',
    'access control', 'data protection', 'privacy', 'gdpr', 'hipaa',
    'iso 27001', 'nist', 'sox', 'pci dss'
  ];

  // Check for security keywords
  const contentLower = content.toLowerCase();
  const foundKeywords = securityKeywords.filter(keyword => 
    contentLower.includes(keyword.toLowerCase())
  );

  analysis.hasSecurityKeywords = foundKeywords.length > 0;
  analysis.securityKeywords = foundKeywords;

  // Estimate reading time (average 200 words per minute)
  analysis.estimatedReadingTime = Math.ceil(analysis.wordCount / 200);

  return analysis;
};

module.exports = {
  extractText,
  processDocument,
  validateFile,
  getFileMetadata,
  formatFileSize,
  analyzeContent,
  cleanExtractedText
};