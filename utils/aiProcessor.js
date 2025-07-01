const axios = require('axios');
const logger = require('./logger');

// Analysis prompts for different types
const ANALYSIS_PROMPTS = {
  'security-review': `
    Please perform a comprehensive cybersecurity review of this document. Focus on:
    1. Security vulnerabilities or weaknesses mentioned
    2. Compliance with security standards (ISO 27001, NIST, etc.)
    3. Risk assessment and mitigation strategies
    4. Access control and authentication mechanisms
    5. Data protection and privacy considerations
    6. Incident response procedures
    7. Security awareness and training requirements
    
    Provide specific recommendations for improvement and highlight any critical security gaps.
  `,
  'policy-analysis': `
    Analyze this document as a cybersecurity policy or procedure. Evaluate:
    1. Completeness and clarity of policy statements
    2. Alignment with industry best practices
    3. Enforceability and measurability
    4. Coverage of key security domains
    5. Roles and responsibilities definition
    6. Compliance and audit requirements
    7. Update and review mechanisms
    
    Suggest improvements and identify missing policy elements.
  `,
  'compliance-check': `
    Review this document for compliance with major cybersecurity frameworks and regulations:
    1. GDPR/CCPA privacy requirements
    2. SOX financial controls
    3. HIPAA healthcare security (if applicable)
    4. PCI DSS payment security (if applicable)
    5. ISO 27001/27002 standards
    6. NIST Cybersecurity Framework
    7. Industry-specific regulations
    
    Identify compliance gaps and provide remediation recommendations.
  `,
  'general': `
    Analyze this document from a cybersecurity perspective and provide:
    1. Summary of key security-related content
    2. Identification of security strengths and weaknesses
    3. Risk areas that need attention
    4. Best practices recommendations
    5. Implementation guidance
    6. Priority areas for improvement
    
    Focus on practical, actionable insights that can improve the organization's security posture.
  `
};

// Claude AI integration
const analyzeWithClaude = async (content, analysisType, customPrompt) => {
  try {
    const prompt = customPrompt || ANALYSIS_PROMPTS[analysisType] || ANALYSIS_PROMPTS['general'];
    
    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-3-sonnet-20240229',
      max_tokens: 4000,
      messages: [
        {
          role: 'user',
          content: `${prompt}\n\nDocument content:\n${content.substring(0, 50000)}`
        }
      ]
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.CLAUDE_API_KEY}`,
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY
      },
      timeout: 60000
    });

    return {
      provider: 'claude',
      analysis: response.data.content[0].text,
      model: 'claude-3-sonnet',
      tokensUsed: response.data.usage?.input_tokens + response.data.usage?.output_tokens || 0,
      status: 'success'
    };

  } catch (error) {
    logger.error('Claude API error:', error.response?.data || error.message);
    throw new Error(`Claude AI service error: ${error.response?.data?.error?.message || error.message}`);
  }
};

// OpenAI integration
const analyzeWithOpenAI = async (content, analysisType, customPrompt) => {
  try {
    const prompt = customPrompt || ANALYSIS_PROMPTS[analysisType] || ANALYSIS_PROMPTS['general'];
    
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are a cybersecurity expert specializing in document analysis and security assessments.'
        },
        {
          role: 'user',
          content: `${prompt}\n\nDocument content:\n${content.substring(0, 50000)}`
        }
      ],
      max_tokens: 4000,
      temperature: 0.3
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    });

    return {
      provider: 'openai',
      analysis: response.data.choices[0].message.content,
      model: 'gpt-4',
      tokensUsed: response.data.usage?.total_tokens || 0,
      status: 'success'
    };

  } catch (error) {
    logger.error('OpenAI API error:', error.response?.data || error.message);
    throw new Error(`OpenAI service error: ${error.response?.data?.error?.message || error.message}`);
  }
};

// Gemini integration
const analyzeWithGemini = async (content, analysisType, customPrompt) => {
  try {
    const prompt = customPrompt || ANALYSIS_PROMPTS[analysisType] || ANALYSIS_PROMPTS['general'];
    
    const response = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      contents: [
        {
          parts: [
            {
              text: `${prompt}\n\nDocument content:\n${content.substring(0, 50000)}`
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 4000
      }
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 60000
    });

    const analysisText = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!analysisText) {
      throw new Error('No analysis text received from Gemini');
    }

    return {
      provider: 'gemini',
      analysis: analysisText,
      model: 'gemini-pro',
      tokensUsed: response.data.usageMetadata?.totalTokenCount || 0,
      status: 'success'
    };

  } catch (error) {
    logger.error('Gemini API error:', error.response?.data || error.message);
    throw new Error(`Gemini service error: ${error.response?.data?.error?.message || error.message}`);
  }
};

// Main analysis function
const analyzeWithAI = async (content, provider, analysisType = 'general', customPrompt = null) => {
  const startTime = Date.now();
  
  try {
    if (!content || content.trim().length === 0) {
      throw new Error('No content provided for analysis');
    }

    if (content.length < 50) {
      throw new Error('Content too short for meaningful analysis');
    }

    let result;

    switch (provider.toLowerCase()) {
      case 'claude':
        if (!process.env.CLAUDE_API_KEY) {
          throw new Error('Claude API key not configured');
        }
        result = await analyzeWithClaude(content, analysisType, customPrompt);
        break;

      case 'openai':
        if (!process.env.OPENAI_API_KEY) {
          throw new Error('OpenAI API key not configured');
        }
        result = await analyzeWithOpenAI(content, analysisType, customPrompt);
        break;

      case 'gemini':
        if (!process.env.GEMINI_API_KEY) {
          throw new Error('Gemini API key not configured');
        }
        result = await analyzeWithGemini(content, analysisType, customPrompt);
        break;

      default:
        throw new Error(`Unsupported AI provider: ${provider}`);
    }

    const processingTime = Date.now() - startTime;

    // Add metadata to result
    result.metadata = {
      analysisType: analysisType,
      contentLength: content.length,
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString()
    };

    // Structure the analysis for better readability
    result.structuredAnalysis = structureAnalysis(result.analysis, analysisType);

    logger.info(`AI analysis completed: ${provider} (${processingTime}ms)`);

    return result;

  } catch (error) {
    logger.error(`AI analysis failed (${provider}):`, error);
    throw error;
  }
};

// Structure analysis output for better presentation
const structureAnalysis = (analysisText, analysisType) => {
  try {
    // Split analysis into sections based on common patterns
    const sections = {
      summary: '',
      findings: [],
      recommendations: [],
      risks: [],
      compliance: []
    };

    const lines = analysisText.split('\n').filter(line => line.trim());
    let currentSection = 'summary';
    let currentContent = '';

    for (const line of lines) {
      const lowerLine = line.toLowerCase();
      
      if (lowerLine.includes('summary') || lowerLine.includes('overview')) {
        currentSection = 'compliance';
      }
      
      currentContent += line + '\n';
    }

    // Add remaining content
    if (currentContent) {
      sections[currentSection] += currentContent;
    }

    // Convert strings to arrays for non-summary sections
    ['findings', 'recommendations', 'risks', 'compliance'].forEach(section => {
      if (sections[section]) {
        sections[section] = sections[section]
          .split('\n')
          .filter(item => item.trim())
          .map(item => item.trim());
      }
    });

    return sections;

  } catch (error) {
    logger.warn('Failed to structure analysis output:', error);
    return {
      summary: analysisText,
      findings: [],
      recommendations: [],
      risks: [],
      compliance: []
    };
  }
};

// Check AI service availability
const checkServiceAvailability = async (provider) => {
  try {
    switch (provider.toLowerCase()) {
      case 'claude':
        return !!process.env.CLAUDE_API_KEY;
      case 'openai':
        return !!process.env.OPENAI_API_KEY;
      case 'gemini':
        return !!process.env.GEMINI_API_KEY;
      default:
        return false;
    }
  } catch (error) {
    return false;
  }
};

module.exports = {
  analyzeWithAI,
  checkServiceAvailability,
  ANALYSIS_PROMPTS
};