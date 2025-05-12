const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Load the credentials file
const CREDENTIALS_PATH = path.join(__dirname, 'google-credentials.json');
let credentials;

try {
  credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
} catch (error) {
  console.error('Error loading google-credentials.json:', error);
  process.exit(1);
}

// Set up authentication based on the credentials type
let auth;

if (credentials.type === 'service_account') {
  // Service account authentication
  auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_PATH,
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/documents.readonly'
    ]
  });
} else {
  // OAuth2 client authentication
  const oauth2Client = new google.auth.OAuth2(
    credentials.client_id,
    credentials.client_secret,
    credentials.redirect_uris[0]
  );
  
  oauth2Client.setCredentials({
    refresh_token: credentials.refresh_token,
    scope: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/documents.readonly'
  });
  
  auth = oauth2Client;
}

// Create Drive API client
const drive = google.drive({ version: 'v3', auth });

// Default folder ID - can be set in .env or in credentials file
const DEFAULT_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || credentials.folder_id;

/**
 * Search Google Drive for files containing specific keywords
 * @param {string} query - The search query
 * @param {string} folderId - Optional folder ID to override the default
 * @returns {Promise<Array>} - Array of matching files
 */
async function searchDrive(query, folderId = null) {
  try {
    // Use the provided folder ID or fall back to the default
    const targetFolderId = folderId || DEFAULT_FOLDER_ID;
    
    let searchQuery = `fullText contains '${query}'`;
    
    // Always limit search to the target folder
    if (targetFolderId) {
      searchQuery += ` and '${targetFolderId}' in parents`;
    }
    
    const response = await drive.files.list({
      q: searchQuery,
      fields: 'files(id, name, webViewLink, mimeType, description)',
      spaces: 'drive'
    });
    
    return response.data.files;
  } catch (error) {
    console.error('Error searching Google Drive:', error);
    throw error;
  }
}

/**
 * Get content of a Google Doc file
 * @param {string} fileId - The Google Doc file ID
 * @returns {Promise<string>} - The text content of the document
 */
async function getDocContent(fileId) {
  try {
    const docs = google.docs({ version: 'v1', auth });
    const response = await docs.documents.get({ documentId: fileId });
    
    // Extract text content from the document
    let content = '';
    const document = response.data;
    
    if (document.body && document.body.content) {
      document.body.content.forEach(element => {
        if (element.paragraph) {
          element.paragraph.elements.forEach(paraElement => {
            if (paraElement.textRun && paraElement.textRun.content) {
              content += paraElement.textRun.content;
            }
          });
        }
      });
    }
    
    return content;
  } catch (error) {
    console.error('Error getting document content:', error);
    throw error;
  }
}

/**
 * Get folder name by ID
 * @param {string} folderId - The folder ID
 * @returns {Promise<string>} - The folder name
 */
async function getFolderName(folderId) {
  try {
    const response = await drive.files.get({
      fileId: folderId,
      fields: 'name'
    });
    
    return response.data.name;
  } catch (error) {
    console.error('Error getting folder name:', error);
    return 'Styrelsemappen';
  }
}

/**
 * Get full content of a Google Doc file and summarize it
 * @param {string} fileId - The Google Doc file ID
 * @param {object} genAI - The Google Generative AI instance
 * @returns {Promise<object>} - The document content and summary
 */
async function summarizeDocument(fileId, genAI) {
  try {
    // First check if the file is a Google Doc
    const fileResponse = await drive.files.get({
      fileId: fileId,
      fields: 'name,mimeType'
    });
    
    const fileName = fileResponse.data.name;
    const mimeType = fileResponse.data.mimeType;
    
    if (mimeType !== 'application/vnd.google-apps.document') {
      return {
        success: false,
        error: 'Filen är inte ett Google Docs-dokument',
        fileName: fileName
      };
    }
    
    // Get the document content
    const docs = google.docs({ version: 'v1', auth });
    const response = await docs.documents.get({ documentId: fileId });
    
    // Extract text content from the document
    let content = '';
    const document = response.data;
    
    if (document.body && document.body.content) {
      document.body.content.forEach(element => {
        if (element.paragraph) {
          element.paragraph.elements.forEach(paraElement => {
            if (paraElement.textRun && paraElement.textRun.content) {
              content += paraElement.textRun.content;
            }
          });
        }
      });
    }
    
    // If we have a Gemini instance, generate a summary
    let summary = '';
    if (genAI) {
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
      const result = await model.generateContent(
        `Sammanfatta följande dokument på svenska. Ge en koncis men informativ sammanfattning:
        
        Dokumenttitel: ${fileName}
        
        ${content}`
      );
      summary = result.response.text();
    }
    
    return {
      success: true,
      fileName: fileName,
      content: content,
      summary: summary
    };
  } catch (error) {
    console.error('Error summarizing document:', error);
    return {
      success: false,
      error: `Ett fel uppstod: ${error.message}`
    };
  }
}

module.exports = {
  searchDrive,
  getDocContent,
  getFolderName,
  DEFAULT_FOLDER_ID,
  summarizeDocument
};