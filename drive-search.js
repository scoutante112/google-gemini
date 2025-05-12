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
      'https://www.googleapis.com/auth/drive', // Full Drive access
      'https://www.googleapis.com/auth/documents' // Full Docs access
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
    scope: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/documents'
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

/**
 * Skapar ett nytt dokument i Google Drive med hjälp av AI
 * @param {string} title - Dokumentets titel
 * @param {string} instructions - Instruktioner för vad dokumentet ska innehålla
 * @param {object} genAI - Google Generative AI-instans
 * @param {string} folderId - Mapp-ID där dokumentet ska sparas (valfritt)
 * @returns {Promise<object>} - Information om det skapade dokumentet
 */
async function createDocumentWithAI(title, instructions, genAI, folderId = DEFAULT_FOLDER_ID) {
  try {
    console.log(`Skapar dokument "${title}" med AI...`);
    
    // Generera innehåll med Gemini
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    
    // Skapa en förbättrad prompt för bättre resultat
    const enhancedPrompt = `Skapa ett professionellt dokument med titeln "${title}" som ska fungera i Google Docs. 
      
Instruktioner: ${instructions}

Dokumentet ska vara välstrukturerat med rubriker, underrubriker och punktlistor där det är lämpligt.
Använd ett formellt och professionellt språk som passar för en elevkårsstyrelse.
Inkludera relevanta detaljer och exempel.

VIKTIGT: Formatera texten med Markdown-syntax som jag kommer att konvertera till Google Docs-format:
- Använd # för huvudrubriker
- Använd ## för underrubriker
- Använd ### för mindre rubriker
- Använd - eller * för punktlistor
- Använd 1. 2. 3. för numrerade listor
- Använd > för citat eller viktiga notiser

Tänk på att dokumentet ska vara enkelt att navigera och använda för styrelsemedlemmar.`;
    
    const result = await model.generateContent(enhancedPrompt);
    const content = result.response.text();
    
    // Skapa ett nytt dokument i Google Drive
    const docs = google.docs({ version: 'v1', auth });
    
    // Först skapa ett tomt dokument
    const fileMetadata = {
      name: title,
      mimeType: 'application/vnd.google-apps.document',
    };
    
    // Om en mapp-ID angavs, lägg till det i metadata
    if (folderId) {
      fileMetadata.parents = [folderId];
    }
    
    // Skapa dokumentet
    const file = await drive.files.create({
      resource: fileMetadata,
      fields: 'id'
    });
    
    const documentId = file.data.id;
    
    // Uppdatera dokumentet med innehållet
    // First, parse the content to identify headings, paragraphs, and lists
    const contentLines = content.split('\n');
    const requests = [];
    let currentIndex = 1; // Start at index 1

    for (let i = 0; i < contentLines.length; i++) {
      const line = contentLines[i].trim();
      
      if (!line) {
        // Empty line - insert a paragraph break
        requests.push({
          insertText: {
            location: { index: currentIndex },
            text: '\n'
          }
        });
        currentIndex += 1;
        continue;
      }
      
      // Check if this is a heading
      if (line.startsWith('# ')) {
        // Heading 1
        const headingText = line.substring(2) + '\n';
        requests.push({
          insertText: {
            location: { index: currentIndex },
            text: headingText
          }
        });
        
        // Apply heading 1 style
        requests.push({
          updateParagraphStyle: {
            range: {
              startIndex: currentIndex,
              endIndex: currentIndex + headingText.length
            },
            paragraphStyle: {
              namedStyleType: 'HEADING_1'
            },
            fields: 'namedStyleType'
          }
        });
        
        currentIndex += headingText.length;
      } else if (line.startsWith('## ')) {
        // Heading 2
        const headingText = line.substring(3) + '\n';
        requests.push({
          insertText: {
            location: { index: currentIndex },
            text: headingText
          }
        });
        
        // Apply heading 2 style
        requests.push({
          updateParagraphStyle: {
            range: {
              startIndex: currentIndex,
              endIndex: currentIndex + headingText.length
            },
            paragraphStyle: {
              namedStyleType: 'HEADING_2'
            },
            fields: 'namedStyleType'
          }
        });
        
        currentIndex += headingText.length;
      } else if (line.startsWith('### ')) {
        // Heading 3
        const headingText = line.substring(4) + '\n';
        requests.push({
          insertText: {
            location: { index: currentIndex },
            text: headingText
          }
        });
        
        // Apply heading 3 style
        requests.push({
          updateParagraphStyle: {
            range: {
              startIndex: currentIndex,
              endIndex: currentIndex + headingText.length
            },
            paragraphStyle: {
              namedStyleType: 'HEADING_3'
            },
            fields: 'namedStyleType'
          }
        });
        
        currentIndex += headingText.length;
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        // Bullet list item
        const itemText = line.substring(2) + '\n';
        requests.push({
          insertText: {
            location: { index: currentIndex },
            text: itemText
          }
        });
        
        // Apply bullet list style
        requests.push({
          createParagraphBullets: {
            range: {
              startIndex: currentIndex,
              endIndex: currentIndex + itemText.length
            },
            bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE'
          }
        });
        
        currentIndex += itemText.length;
      } else if (line.match(/^\d+\. /)) {
        // Numbered list item
        const itemText = line.substring(line.indexOf('. ') + 2) + '\n';
        requests.push({
          insertText: {
            location: { index: currentIndex },
            text: itemText
          }
        });
        
        // Apply numbered list style
        requests.push({
          createParagraphBullets: {
            range: {
              startIndex: currentIndex,
              endIndex: currentIndex + itemText.length
            },
            bulletPreset: 'NUMBERED_DECIMAL'
          }
        });
        
        currentIndex += itemText.length;
      } else if (line.startsWith('> ')) {
        // Blockquote
        const quoteText = line.substring(2) + '\n';
        requests.push({
          insertText: {
            location: { index: currentIndex },
            text: quoteText
          }
        });
        
        // Apply indentation for blockquote
        requests.push({
          updateParagraphStyle: {
            range: {
              startIndex: currentIndex,
              endIndex: currentIndex + quoteText.length
            },
            paragraphStyle: {
              indentFirstLine: {
                magnitude: 36,
                unit: 'PT'
              },
              indentStart: {
                magnitude: 36,
                unit: 'PT'
              }
            },
            fields: 'indentFirstLine,indentStart'
          }
        });
        
        currentIndex += quoteText.length;
      } else {
        // Regular paragraph
        const paragraphText = line + '\n';
        requests.push({
          insertText: {
            location: { index: currentIndex },
            text: paragraphText
          }
        });
        
        currentIndex += paragraphText.length;
      }
    }

    // Execute all the formatting requests
    await docs.documents.batchUpdate({
      documentId: documentId,
      requestBody: {
        requests: requests
      }
    });
    
    // Hämta länk till dokumentet
    const getResponse = await drive.files.get({
      fileId: documentId,
      fields: 'webViewLink,id,name'
    });
    
    return {
      success: true,
      id: documentId,
      name: title,
      link: getResponse.data.webViewLink,
      content: content
    };
  } catch (error) {
    console.error('Fel vid skapande av dokument med AI:', error);
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
  summarizeDocument,
  createDocumentWithAI
};