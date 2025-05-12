require('dotenv').config();
const { Client4 } = require('@mattermost/client');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const INTRODUCED_CHANNELS_FILE = path.join(__dirname, 'introduced_channels.json');
let introducedChannels = new Set();

const { 
  createMeeting, 
  getUpcomingMeetings, 
  deleteMeeting, 
  updateMeeting,
  testCalendarAccess,
  createAndShareCalendar
} = require('./meeting-manager');


// Load previously introduced channels from file
try {
  if (fs.existsSync(INTRODUCED_CHANNELS_FILE)) {
    const channelsData = JSON.parse(fs.readFileSync(INTRODUCED_CHANNELS_FILE, 'utf8'));
    introducedChannels = new Set(channelsData);
    console.log(`Loaded ${introducedChannels.size} previously introduced channels`);
  }
} catch (error) {
  console.error('Error loading introduced channels:', error);
  // Continue with empty set if file can't be loaded
}

// Function to save the introduced channels to file
function saveIntroducedChannels() {
  try {
    const channelsArray = Array.from(introducedChannels);
    fs.writeFileSync(INTRODUCED_CHANNELS_FILE, JSON.stringify(channelsArray), 'utf8');
    console.log(`Saved ${introducedChannels.size} introduced channels to file`);
  } catch (error) {
    console.error('Error saving introduced channels:', error);
  }
}

const { searchDrive, getDocContent, getFolderName, DEFAULT_FOLDER_ID, summarizeDocument, createDocumentWithAI } = require('./drive-search');
// Mattermost konfiguration
const MM_BOT_TOKEN = process.env.MATTERMOST_BOT_TOKEN;
const MM_SERVER_URL = process.env.MATTERMOST_SERVER_URL;

// Google Gemini konfiguration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Kontrollera att alla nödvändiga miljövariabler är satta
if (!MM_BOT_TOKEN || !MM_SERVER_URL || !GEMINI_API_KEY) {
  console.error('Saknar nödvändiga miljövariabler. Kontrollera din .env-fil.');
  console.error('Behöver: MATTERMOST_BOT_TOKEN, MATTERMOST_SERVER_URL, GEMINI_API_KEY');
  process.exit(1);
}

// Initiera Mattermost klient
const client = new Client4();
client.setUrl(MM_SERVER_URL);
client.setToken(MM_BOT_TOKEN);

// Initiera Gemini-klient med elevkårsstyrelsens kontext
const MODEL_NAME = 'gemini-2.0-flash';
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
  model: MODEL_NAME,
  systemInstruction: `Du är en hjälpsam assistent för elevkårens styrelse. 
  Din uppgift är att hjälpa styrelsemedlemmar med:
  - Mötesprotokoll och dokumentation
  - Planering av evenemang och aktiviteter
  - Budgetfrågor och ekonomihantering
  - Stadgar och regelverk
  - Kommunikation med medlemmar
  - Projekthantering och uppföljning
  
  Du kan också hjälpa till att:
  - Söka i Google Drive genom att användaren skriver "sök efter [sökord]" 
  - Sammanfatta dokument genom att användaren skriver "sammanfatta dokument [dokument-URL eller namn]"
  
  Var professionell, koncis och fokuserad på att hjälpa styrelsen att arbeta effektivt.
  Föreslå konkreta lösningar och tillvägagångssätt när det är lämpligt.
  Om du inte vet svaret på en specifik fråga om elevkårens interna processer, 
  var tydlig med det och föreslå hur styrelsemedlemmen kan hitta informationen.`
});

// Vanliga styrelsefrågor och svar
const commonBoardQuestions = {
  'stadgar': 'Elevkårens stadgar finns i styrelsemappen på Google Drive. De senast uppdaterade stadgarna antogs på årsmötet [DATUM]. Om du behöver göra ändringar måste dessa godkännas på ett årsmöte eller extrainsatt årsmöte.',
  'firmatecknare': 'Elevkårens firmatecknare är ordförande och kassör, som tecknar firma var för sig upp till [BELOPP] kr. För belopp över detta krävs styrelsebeslut.',
  'attesträtt': 'Attesträtt har ordförande och kassör för belopp upp till [BELOPP] kr. Utskottsansvariga har attesträtt inom sin budget upp till [BELOPP] kr.',
  'årsmöte': 'Årsmötet ska enligt stadgarna hållas innan [MÅNAD]. Kallelse ska skickas ut minst [ANTAL] veckor innan mötet. Motioner ska vara inkomna senast [ANTAL] veckor innan mötet.',
  'verksamhetsplan': 'Verksamhetsplanen för innevarande år finns i styrelsemappen på Google Drive. Den innehåller våra mål och planerade aktiviteter för året.',
  'bokföring': 'Bokföringen sköts i programmet [PROGRAM]. Kassören ansvarar för att alla kvitton och underlag registreras. Kvitton ska lämnas in senast [ANTAL] dagar efter inköp.',
};

// Styrelsespecifika kommandon och mallar
const boardCommands = {
  '/dagordning': `# Dagordning styrelsemöte [DATUM]

1. Mötets öppnande
2. Val av mötesordförande
3. Val av mötessekreterare
4. Val av justerare
5. Godkännande av dagordning
6. Föregående protokoll
7. Rapporter
   a) Ordförande
   b) Vice ordförande
   c) Kassör
   d) Sekreterare
   e) Utskottsansvariga
8. Beslutsärenden
9. Diskussionsärenden
10. Övriga frågor
11. Nästa möte
12. Mötets avslutande`,

  '/protokoll': `# Protokoll styrelsemöte [DATUM]

Närvarande: [NAMN], [NAMN], [NAMN]
Frånvarande: [NAMN]

§1. Mötets öppnande
Ordförande förklarade mötet öppnat.

§2. Val av mötesordförande
[NAMN] valdes till mötesordförande.

§3. Val av mötessekreterare
[NAMN] valdes till mötessekreterare.

§4. Val av justerare
[NAMN] valdes till justerare.

§5. Godkännande av dagordning
Dagordningen godkändes.

[Fortsätt med resterande punkter...]`,

  '/budget': `# Budgetmall

## Intäkter
- Medlemsavgifter: [BELOPP] kr
- Sponsring: [BELOPP] kr
- Evenemang: [BELOPP] kr
- Övrigt: [BELOPP] kr
**Totala intäkter: [SUMMA] kr**

## Utgifter
- Evenemang: [BELOPP] kr
- Marknadsföring: [BELOPP] kr
- Administration: [BELOPP] kr
- Övrigt: [BELOPP] kr
**Totala utgifter: [SUMMA] kr**

**Resultat: [SUMMA] kr**`,

  '/visa-moten': async function(client, post) {
    try {
      const upcomingMeetings = await getUpcomingMeetings();
      
      if (upcomingMeetings.length === 0) {
        await client.createPost({
          channel_id: post.channel_id,
          message: '## 📅 Kommande möten\n\nInga kommande möten är schemalagda.',
          ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
        });
        return;
      }
      
      // Sort meetings by date
      upcomingMeetings.sort((a, b) => {
        const dateA = new Date(`${a.date}T${a.time}`);
        const dateB = new Date(`${b.date}T${b.time}`);
        return dateA - dateB;
      });
      
      let messageText = '## 📅 Kommande möten\n\n';
      
      upcomingMeetings.forEach(meeting => {
        // Format date for display
        const [year, month, day] = meeting.date.split('-');
        const formattedDate = `${day}/${month}/${year}`;
        
        messageText += `### ${meeting.title}\n`;
        messageText += `**Datum:** ${formattedDate}\n`;
        messageText += `**Tid:** ${meeting.time}\n`;
        messageText += `**Plats:** ${meeting.location}\n`;
        
        if (meeting.attendees && meeting.attendees.length > 0) {
          messageText += `**Deltagare:** ${meeting.attendees.join(', ')}\n`;
        }
        
        if (meeting.calendar_link) {
          messageText += `**Kalender:** [Visa i Google Calendar](${meeting.calendar_link})\n`;
        }
        
        messageText += `**Mötes-ID:** \`${meeting.id}\`\n\n`;
      });
      
      messageText += 'För att hantera ett möte, använd kommandot `/ta-bort-mote [ID]` eller `/uppdatera-mote [ID] [fält] [värde]`.';
      
      await client.createPost({
        channel_id: post.channel_id,
        message: messageText,
        ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
      });
    } catch (error) {
      console.error('Fel vid visning av möten:', error);
      await client.createPost({
        channel_id: post.channel_id,
        message: 'Ett fel uppstod vid visning av möten.',
        ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
      });
    }
  },

  '/hjälp': `**Tillgängliga kommandon:**
- /dagordning - Genererar en mall för dagordning
- /protokoll - Genererar en mall för mötesprotokoll
- /budget - Genererar en budgetmall
- /checklista - Genererar en checklista för evenemang
- /visa-moten - Visar kommande möten
- /hjälp - Visar denna hjälptext

**Möteshantering:**
- /skapa-möte [titel] [datum YYYY-MM-DD] [tid HH:MM] [plats] - Skapar ett nytt möte
- /visa-möten - Visar alla kommande möten
- /påminn-möte [mötes-ID] - Skickar en påminnelse om ett möte nu
- /ta-bort-möte [mötes-ID] - Tar bort ett schemalagt möte

**Andra funktioner:**
- Sök efter [sökord] - Söker i Google Drive efter dokument
- Sammanfatta dokument [URL eller namn] - Sammanfattar ett dokument
- Skapa dokument [titel] - [instruktioner] - Skapar ett nytt dokument med AI

Du kan också ställa frågor om styrelsearbete, planering, eller be om hjälp med formuleringar för kommunikation.`,

  '/checklista': `# Checklista för evenemang

## Före evenemang
- [ ] Fastställ datum och tid
- [ ] Boka lokal
- [ ] Skapa budget
- - [ ] Marknadsför på sociala medier
- [ ] Skapa anmälningsformulär
- [ ] Kontakta eventuella samarbetspartners
- [ ] Planera aktiviteter

## Under evenemang
- [ ] Registrera deltagare
- [ ] Dokumentera med foton
- [ ] Samla in feedback

## Efter evenemang
- [ ] Tacka deltagare och samarbetspartners
- [ ] Sammanställ feedback
- [ ] Ekonomisk uppföljning
- [ ] Utvärderingsmöte
- [ ] Dokumentera lärdomar för framtida evenemang`
};

// Funktion för att hantera meddelanden
async function handleMessage(data) {
  try {
    const msg = JSON.parse(data);
    console.log('Mottaget meddelande typ:', msg.event);
    
    // Hantera endast nya meddelanden
    if (msg.event === 'posted') {
      console.log('Nytt meddelande postat');
      
      try {
        const post = JSON.parse(msg.data.post);
        console.log('Meddelande från användare:', post.user_id);
        console.log('Meddelande innehåll:', post.message);
        
        // Hämta bot-ID
        const me = await client.getMe();
        const botId = me.id;
        console.log('Bot ID:', botId);
        
        // Ignorera botens egna meddelanden
        if (post.user_id === botId) {
          console.log('Ignorerar botens eget meddelande');
          return;
        }
        
        // Kontrollera om boten är omnämnd eller om meddelandet är i en DM-kanal
        const isMentioned = post.message.includes(`@${botId}`);
        const isDirect = msg.data.channel_type === 'D';
        console.log('Är omnämnd:', isMentioned);
        console.log('Är direktmeddelande:', isDirect);
        
        if (isMentioned || isDirect) {
          // Ta bort omnämningen från meddelandet
          const cleanMessage = post.message.replace(new RegExp(`@${botId}`, 'g'), '').trim();
          console.log('Rensat meddelande:', cleanMessage);
          
          // Kolla om boten behöver presentera sig i denna kanal
          if (!introducedChannels.has(post.channel_id)) {
            introducedChannels.add(post.channel_id);
            saveIntroducedChannels(); // Save to file after adding a new channel
            
            try {
              // Get the user's information to personalize the greeting
              const user = await client.getUser(post.user_id);
              const userName = user.first_name || user.username; // Use first name if available, otherwise username
              
              // Send personalized welcome message
              await client.createPost({
                channel_id: post.channel_id,
                message: `Hej ${userName}! Jag är er AI-assistent för styrelsearbetet. Jag kan hjälpa till med att generera mallar, svara på frågor om styrelsearbete, och assistera med planering. 

Jag kan också:
- Söka i Google Drive: "sök efter [sökord]"
- Sammanfatta dokument: "sammanfatta dokument [URL eller namn]"
- Skapa nya dokument: "skapa dokument [titel] - [instruktioner]"

Skriv \`/hjälp\` för att se alla tillgängliga kommandon.`,
              });
              
              // If it was just a greeting, end here
              if (cleanMessage.match(/^(hej|hallå|tjena|hello|hi)/i)) {
                return;
              }
            } catch (error) {
              console.error('Kunde inte hämta användarinformation:', error);
              
              // Fallback to generic greeting if user info can't be retrieved
              await client.createPost({
                channel_id: post.channel_id,
                message: 'Hej! Jag är er AI-assistent för styrelsearbetet. Jag kan hjälpa till med att generera mallar, svara på frågor om styrelsearbete, och assistera med planering. Skriv `/hjälp` för att se tillgängliga kommandon.',
              });
              
              if (cleanMessage.match(/^(hej|hallå|tjena|hello|hi)/i)) {
                return;
              }
            }
          }
          
          // Kolla om meddelandet är ett styrelsekommando
          if (cleanMessage.startsWith('/')) {
            const command = cleanMessage.split(' ')[0].toLowerCase();
            if (boardCommands[command]) {
              console.log('Matchade styrelsekommando:', command);
              
              // Check if the command is a function or a string
              if (typeof boardCommands[command] === 'function') {
                // If it's a function, call it
                await boardCommands[command](client, post);
              } else {
                // If it's a string, send it as a message
                await client.createPost({
                  channel_id: post.channel_id,
                  message: boardCommands[command],
                  ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
                });
              }
              return;
            }
          }
          
          // Check for natural language search queries
          if (cleanMessage.toLowerCase().startsWith('sök efter') || 
              cleanMessage.toLowerCase().startsWith('leta efter') || 
              cleanMessage.toLowerCase().startsWith('hitta') ||
              cleanMessage.toLowerCase().match(/^(sök|leta|hitta)\s/i)) {
            
            console.log('Naturlig språksökning i Google Drive detekterad');
            
            // Extract the search query
            let searchQuery = '';
            if (cleanMessage.toLowerCase().startsWith('sök efter')) {
              searchQuery = cleanMessage.substring('sök efter'.length).trim();
            } else if (cleanMessage.toLowerCase().startsWith('leta efter')) {
              searchQuery = cleanMessage.substring('leta efter'.length).trim();
            } else if (cleanMessage.toLowerCase().startsWith('hitta')) {
              searchQuery = cleanMessage.substring('hitta'.length).trim();
            } else {
              // Handle "sök X", "leta X", "hitta X" patterns
              searchQuery = cleanMessage.substring(cleanMessage.indexOf(' ')).trim();
            }
            
            // We'll always use the default folder unless explicitly overridden
            let folderId = DEFAULT_FOLDER_ID;
            
            try {
              // Get the folder name for better user feedback
              const folderName = await getFolderName(folderId);
              
              // Send a message that we're searching
              await client.createPost({
                channel_id: post.channel_id,
                message: `Söker efter "${searchQuery}" i styrelsemappen "${folderName}"...`,
                ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
              });
              
              const results = await searchDrive(searchQuery);
              
              if (results.length === 0) {
                await client.createPost({
                  channel_id: post.channel_id,
                  message: `Inga dokument hittades för sökningen "${searchQuery}" i styrelsemappen.`,
                  ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
                });
                return;
              }
              
              // Format the results
              let responseMessage = `### Sökresultat för "${searchQuery}" i styrelsemappen\n\n`;
              
              for (let i = 0; i < Math.min(results.length, 10); i++) {
                const file = results[i];
                let fileInfo = `${i+1}. [${file.name}](${file.webViewLink})`;
                
                // Add description if available
                if (file.description) {
                  fileInfo += ` - ${file.description}`;
                }
                
                responseMessage += fileInfo + '\n';
              }
              
              if (results.length > 10) {
                responseMessage += `\n_Visar 10 av ${results.length} resultat._`;
              }
              
              await client.createPost({
                channel_id: post.channel_id,
                message: responseMessage,
                ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
              });
              return; // Skip Gemini processing
            } catch (error) {
              console.error('Fel vid sökning i Google Drive:', error);
              await client.createPost({
                channel_id: post.channel_id,
                message: 'Ett fel uppstod vid sökning i Google Drive. Kontrollera loggarna för mer information.',
                ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
              });
              return; // Skip Gemini processing
            }
          }
          
          // Check for document summarization requests
          if (cleanMessage.toLowerCase().startsWith('sammanfatta dokument') || 
              cleanMessage.toLowerCase().includes('sammanfatta dokumentet') ||
              cleanMessage.toLowerCase().match(/sammanfatta\s+https:\/\/docs\.google\.com\/document\/d\//i)) {
            
            console.log('Dokumentsammanfattning begärd');
            
            // Extract the document ID
            let docId = null;
            
            // Check if the message contains a Google Docs URL
            const docUrlMatch = cleanMessage.match(/https:\/\/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
            if (docUrlMatch && docUrlMatch[1]) {
              docId = docUrlMatch[1];
            } else {
              // Try to extract the document ID or name from the message
              const docQuery = cleanMessage.replace(/sammanfatta dokument(et)?/i, '').trim();
              
              if (docQuery) {
                // If it looks like a document ID (long string of characters)
                if (docQuery.length > 20 && !docQuery.includes(' ')) {
                  docId = docQuery;
                } else {
                  // Search for the document by name
                  try {
                    await client.createPost({
                      channel_id: post.channel_id,
                      message: `Söker efter dokument med namn "${docQuery}"...`,
                      ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
                    });
                    
                    const results = await searchDrive(docQuery);
                    
                    if (results.length === 0) {
                      await client.createPost({
                        channel_id: post.channel_id,
                        message: `Hittade inget dokument med namn som matchar "${docQuery}".`,
                        ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
                      });
                      return;
                    }
                    
                    // Use the first Google Doc result
                    for (const file of results) {
                      if (file.mimeType === 'application/vnd.google-apps.document') {
                        docId = file.id;
                        break;
                      }
                    }
                    
                    if (!docId) {
                      await client.createPost({
                        channel_id: post.channel_id,
                        message: `Hittade inga Google Docs-dokument som matchar "${docQuery}".`,
                        ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
                      });
                      return;
                    }
                  } catch (error) {
                    console.error('Fel vid sökning efter dokument:', error);
                    await client.createPost({
                      channel_id: post.channel_id,
                      message: 'Ett fel uppstod vid sökning efter dokumentet. Kontrollera loggarna för mer information.',
                      ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
                    });
                    return;
                  }
                }
              } else {
                await client.createPost({
                  channel_id: post.channel_id,
                  message: 'Användning: "sammanfatta dokument [dokument-ID eller URL eller namn]"',
                  ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
                });
                return;
              }
            }
            
            // Now we have a document ID, let's summarize it
            try {
              await client.createPost({
                channel_id: post.channel_id,
                message: 'Hämtar och sammanfattar dokumentet...',
                ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
              });
              
              const result = await summarizeDocument(docId, genAI);
              
              if (!result.success) {
                await client.createPost({
                  channel_id: post.channel_id,
                  message: `Kunde inte sammanfatta dokumentet: ${result.error || 'Okänt fel'}`,
                  ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
                });
                return;
              }
              
              // Send the summary
              const responseMessage = `## Sammanfattning av "${result.fileName}"\n\n${result.summary}`;
              
              await client.createPost({
                channel_id: post.channel_id,
                message: responseMessage,
                ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
              });
              return;
            } catch (error) {
              console.error('Fel vid sammanfattning av dokument:', error);
              await client.createPost({
                channel_id: post.channel_id,
                message: 'Ett fel uppstod vid sammanfattning av dokumentet. Kontrollera loggarna för mer information.',
                ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
              });
              return;
            }
          }
          
          // Kontrollera om användaren vill skapa ett dokument med AI
          if (cleanMessage.toLowerCase().startsWith('skapa dokument') || 
              cleanMessage.toLowerCase().startsWith('generera dokument')) {
            
            console.log('Dokumentskapande begärt');
            
            // Extrahera titel och instruktioner från meddelandet
            const match = cleanMessage.match(/skapa dokument|generera dokument/i);
            if (match) {
              const restOfMessage = cleanMessage.substring(match[0].length).trim();
              
              // Kontrollera om vi har tillräckligt med information
              if (!restOfMessage) {
                await client.createPost({
                  channel_id: post.channel_id,
                  message: 'För att skapa ett dokument, ange en titel och instruktioner. Till exempel: "skapa dokument Projektplan för vårbalen - Skapa en detaljerad projektplan för vårbalen med tidslinjer, budget och ansvarsområden"',
                  ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
                });
                return;
              }
              
              // Försök hitta titel och instruktioner
              let title, instructions;
              
              // Kolla om det finns ett bindestreck som separerar titel och instruktioner
              if (restOfMessage.includes('-')) {
                const parts = restOfMessage.split('-');
                title = parts[0].trim();
                instructions = parts.slice(1).join('-').trim();
              } else if (restOfMessage.includes(':')) {
                // Eller om det finns ett kolon
                const parts = restOfMessage.split(':');
                title = parts[0].trim();
                instructions = parts.slice(1).join(':').trim();
              } else {
                // Annars ta de första 5 orden som titel och resten som instruktioner
                const words = restOfMessage.split(' ');
                if (words.length <= 5) {
                  title = restOfMessage;
                  instructions = `Skapa ett dokument med titeln "${title}"`;
                } else {
                  title = words.slice(0, 5).join(' ');
                  instructions = restOfMessage;
                }
              }
              
              // Meddela användaren att dokumentet skapas
              await client.createPost({
                channel_id: post.channel_id,
                message: `Skapar dokument med titeln "${title}"...`,
                ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
              });
              
              try {
                // Förbättra instruktionerna för att få bättre resultat
                const enhancedPrompt = `Skapa ett professionellt dokument med titeln "${title}". 
                
Instruktioner: ${instructions}

Dokumentet ska vara välstrukturerat med rubriker, underrubriker och punktlistor där det är lämpligt.
Använd ett formellt och professionellt språk som passar för en elevkårsstyrelse.
Inkludera relevanta detaljer och exempel.
Formatera texten med markdown där det är lämpligt.`;
                
                // Skapa dokumentet
                const result = await createDocumentWithAI(title, instructions, genAI);
                
                if (!result.success) {
                  await client.createPost({
                    channel_id: post.channel_id,
                    message: `Kunde inte skapa dokumentet: ${result.error || 'Okänt fel'}`,
                    ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
                  });
                  return;
                }
                
                // Skicka länk till det skapade dokumentet
                await client.createPost({
                  channel_id: post.channel_id,
                  message: `✅ Dokument skapat: [${result.name}](${result.link})`,
                  ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
                });
                return;
              } catch (error) {
                console.error('Fel vid skapande av dokument:', error);
                await client.createPost({
                  channel_id: post.channel_id,
                  message: 'Ett fel uppstod vid skapande av dokumentet. Kontrollera loggarna för mer information.',
                  ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
                });
                return;
              }
            }
          }
          
          // Lägg till detta i din handleMessage-funktion för att hantera möteskommandon
          // Kolla om meddelandet är ett möteskommando
          if (cleanMessage.toLowerCase().startsWith('/skapa-möte')) {
            console.log('Mötesskapande begärt');
            
            // Extrahera mötesdetaljer från meddelandet
            const meetingDetails = cleanMessage.substring('/skapa-möte'.length).trim();
            
            // Kontrollera om vi har tillräckligt med information
            if (!meetingDetails) {
              await client.createPost({
                channel_id: post.channel_id,
                message: 'För att skapa ett möte, ange titel, datum, tid och plats. Exempel: `/skapa-möte Styrelsemöte 2023-06-15 18:00 Konferensrummet`',
                ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
              });
              return;
            }
            
            try {
              // Försök tolka mötesdetaljer
              // Format: /skapa-möte [titel] [datum YYYY-MM-DD] [tid HH:MM] [plats]
              const parts = meetingDetails.split(' ');
              
              // Hitta datum (format YYYY-MM-DD)
              const dateIndex = parts.findIndex(part => part.match(/^\d{4}-\d{2}-\d{2}$/));
              if (dateIndex === -1) {
                await client.createPost({
                  channel_id: post.channel_id,
                  message: 'Kunde inte hitta ett giltigt datum i formatet YYYY-MM-DD. Exempel: 2023-06-15',
                  ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
                });
                return;
              }
              
              const date = parts[dateIndex];
              
              // Hitta tid (format HH:MM)
              const timeIndex = parts.findIndex(part => part.match(/^\d{2}:\d{2}$/));
              const time = timeIndex !== -1 ? parts[timeIndex] : '18:00'; // Standard: 18:00
              
              // Extrahera titel (allt före datum)
              const title = parts.slice(0, dateIndex).join(' ');
              
              // Extrahera plats (allt efter tid, eller efter datum om tid saknas)
              const locationStartIndex = timeIndex !== -1 ? timeIndex + 1 : dateIndex + 1;
              const location = parts.slice(locationStartIndex).join(' ') || 'Online'; // Standard: Online
              
              // Kolla om det finns e-postadresser i meddelandet (börjar med @)
              const attendees = [];
              parts.forEach(part => {
                if (part.startsWith('@') && part.includes('@')) {
                  // Ta bort @ i början om det finns
                  const email = part.startsWith('@') ? part.substring(1) : part;
                  attendees.push(email);
                }
              });

              // Lägg alltid till anton.bystrom@elev.praktiska.se
              if (!attendees.includes('anton.bystrom@elev.praktiska.se')) {
                attendees.push('anton.bystrom@elev.praktiska.se');
              }

              // Skapa mötet med deltagare
              const result = await createMeeting({
                title,
                date,
                time,
                location,
                channel_id: post.channel_id,
                organizer: post.user_id,
                attendees: attendees,
                addToCalendar: true // Försök lägga till i Google Calendar
              });
              
              if (result.success) {
                // Formatera datum för visning
                const [year, month, day] = date.split('-');
                const formattedDate = `${day}/${month}/${year}`;
                
                // Skapa bekräftelsemeddelande
                let message = `## ✅ Möte skapat: ${title}\n\n`;
                message += `**Datum:** ${formattedDate}\n`;
                message += `**Tid:** ${time}\n`;
                message += `**Plats:** ${location}\n\n`;
                
                // Lista deltagare
                if (attendees && attendees.length > 0) {
                  message += `**Deltagare:** ${attendees.join(', ')}\n\n`;
                }
                
                if (result.calendarAdded && result.calendarLink) {
                  message += `**Kalender:** [Visa i Google Calendar](${result.calendarLink})\n\n`;
                } else {
                  message += `**Notera:** Kunde inte lägga till mötet i Google Calendar.\n`;
                  if (result.calendarError) {
                    message += `Fel: ${result.calendarError}\n\n`;
                    message += `Prova att köra \`/testa-kalender\` för att kontrollera kalenderbehörigheter.\n\n`;
                  } else {
                    message += `Mötet är ändå schemalagt i systemet.\n\n`;
                  }
                }
                
                message += `Mötet har schemalagts och påminnelser kommer att skickas en vecka innan.\n`;
                message += `Mötes-ID: \`${result.meeting.id}\` (använd detta ID för att hantera mötet)`;
                
                await client.createPost({
                  channel_id: post.channel_id,
                  message,
                  ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
                });
              } else {
                await client.createPost({
                  channel_id: post.channel_id,
                  message: `Kunde inte skapa mötet: ${result.error || 'Okänt fel'}`,
                  ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
                });
              }
            } catch (error) {
              console.error('Fel vid skapande av möte:', error);
              await client.createPost({
                channel_id: post.channel_id,
                message: 'Ett fel uppstod vid skapande av mötet. Kontrollera formatet och försök igen.',
                ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
              });
            }
            
            return;
          }
          
          // Hantera kommandot för att visa möten
          if (cleanMessage.toLowerCase() === '/visa-moten') {
            console.log('Visning av möten begärd');
            
            try {
              // Använd funktionen från boardCommands
              const message = await boardCommands['/visa-moten']();
              
              await client.createPost({
                channel_id: post.channel_id,
                message,
                ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
              });
            } catch (error) {
              console.error('Fel vid visning av möten:', error);
              await client.createPost({
                channel_id: post.channel_id,
                message: 'Ett fel uppstod vid hämtning av möten.',
                ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
              });
            }
            
            return;
          }
          
          // Hantera kommandot för att skicka påminnelse om ett möte nu
          if (cleanMessage.toLowerCase().startsWith('/påminn-möte')) {
            console.log('Manuell mötespåminnelse begärd');
            
            const meetingId = cleanMessage.substring('/påminn-möte'.length).trim();
            
            if (!meetingId) {
              await client.createPost({
                channel_id: post.channel_id,
                message: 'Ange ett mötes-ID för att skicka en påminnelse. Exempel: `/påminn-möte 1621234567890`',
                ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
              });
              return;
            }
            
            try {
              // Hämta alla kommande möten
              const upcomingMeetings = getUpcomingMeetings();
              
              // Hitta det specifika mötet
              const meeting = upcomingMeetings.find(m => m.id === meetingId);
              
              if (!meeting) {
                await client.createPost({
                  channel_id: post.channel_id,
                  message: `Kunde inte hitta något kommande möte med ID: ${meetingId}`,
                  ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
                });
                return;
              }
              
              // Formatera datum och tid
              const [year, month, day] = meeting.date.split('-');
              const formattedDate = `${day}/${month}/${year}`;
              
              // Skapa påminnelsemeddelande
              const reminderMessage = `## 📅 Påminnelse: ${meeting.title}
              
**Datum:** ${formattedDate}
**Tid:** ${meeting.time}
**Plats:** ${meeting.location}

${meeting.description ? `**Beskrivning:** ${meeting.description}\n\n` : ''}
Detta är en påminnelse om ett kommande styrelsemöte. Vänligen bekräfta din närvaro.`;
              
              // Skicka påminnelse till kanalen
              await client.createPost({
                channel_id: meeting.channel_id,
                message: reminderMessage
              });
              
              // Bekräfta att påminnelsen skickades
              await client.createPost({
                channel_id: post.channel_id,
                message: `✅ Påminnelse skickad för mötet "${meeting.title}"`,
                ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
              });
            } catch (error) {
              console.error('Fel vid skickande av manuell mötespåminnelse:', error);
              await client.createPost({
                channel_id: post.channel_id,
                message: 'Ett fel uppstod vid skickande av påminnelse.',
                ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
              });
            }
            
            return;
          }
          
          // Hantera kommandot för att ta bort ett möte
          if (cleanMessage.toLowerCase().startsWith('/ta-bort-möte')) {
            console.log('Borttagning av möte begärd');
            
            const meetingId = cleanMessage.substring('/ta-bort-möte'.length).trim();
            
            if (!meetingId) {
              await client.createPost({
                channel_id: post.channel_id,
                message: 'Ange ett mötes-ID för att ta bort ett möte. Exempel: `/ta-bort-möte 1621234567890`',
                ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
              });
              return;
            }
            
            try {
              const success = deleteMeeting(meetingId);
              
              if (success) {
                await client.createPost({
                  channel_id: post.channel_id,
                  message: `✅ Mötet med ID ${meetingId} har tagits bort.`,
                  ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
                });
              } else {
                await client.createPost({
                  channel_id: post.channel_id,
                  message: `Kunde inte hitta något möte med ID: ${meetingId}`,
                  ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
                });
              }
            } catch (error) {
              console.error('Fel vid borttagning av möte:', error);
              await client.createPost({
                channel_id: post.channel_id,
                message: 'Ett fel uppstod vid borttagning av mötet.',
                ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
              });
            }
            
            return;
          }
          
          // Lägg till detta i din handleMessage-funktion
          if (cleanMessage.toLowerCase() === '/testa-kalender') {
            console.log('Testar kalenderbehörigheter...');
            
            try {
              const result = await testCalendarAccess();
              
              if (result.success) {
                let message = '## ✅ Kalenderbehörigheter OK\n\n';
                message += 'Följande kalendrar är tillgängliga:\n\n';
                
                result.calendars.forEach(cal => {
                  message += `- **${cal.summary}** (${cal.id})\n`;
                });
                
                message += '\nAnvänd kalender-ID i din konfiguration för att skapa händelser.';
                
                await client.createPost({
                  channel_id: post.channel_id,
                  message,
                  ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
                });
              } else {
                await client.createPost({
                  channel_id: post.channel_id,
                  message: `## ❌ Kalenderbehörigheter misslyckades\n\nFel: ${result.error}`,
                  ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
                });
              }
            } catch (error) {
              console.error('Fel vid test av kalenderbehörigheter:', error);
              await client.createPost({
                channel_id: post.channel_id,
                message: 'Ett fel uppstod vid test av kalenderbehörigheter.',
                ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
              });
            }
            
            return;
          }
          
          // Extrahera kalendernamn och e-postadress från kommandot
          // Format: /skapa-kalender Kalendernamn email@example.com
          if (cleanMessage.toLowerCase().startsWith('/skapa-kalender')) {
            const parts = cleanMessage.split(' ');
            
            if (parts.length < 3) {
              await client.createPost({
                channel_id: post.channel_id,
                message: '## ❌ Felaktigt format\n\nAnvänd: `/skapa-kalender Kalendernamn email@example.com`',
                ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
              });
              return;
            }
            
            const calendarName = parts[1];
            const shareWithEmail = parts[2];
            
            // Validera e-postadressen
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(shareWithEmail)) {
              await client.createPost({
                channel_id: post.channel_id,
                message: '## ❌ Ogiltig e-postadress\n\nVänligen ange en giltig e-postadress.',
                ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
              });
              return;
            }
            
            // Visa att processen har startat
            await client.createPost({
              channel_id: post.channel_id,
              message: `Skapar kalender "${calendarName}" och delar med ${shareWithEmail}...`,
              ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
            });
            
            try {
              const result = await createAndShareCalendar(calendarName, shareWithEmail);
              
              if (result.success) {
                await client.createPost({
                  channel_id: post.channel_id,
                  message: `## ✅ Kalender skapad och delad\n\n` +
                           `**Namn:** ${result.calendarName}\n` +
                           `**Delad med:** ${shareWithEmail}\n` +
                           `**Kalender-ID:** \`${result.calendarId}\`\n\n` +
                           `Kalendern bör nu vara tillgänglig i Google Calendar för ${shareWithEmail}.\n` +
                           `Du kan nu använda detta kalender-ID för att skapa möten.`,
                  ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
                });
                
                // Spara kalender-ID:t i en konfigurationsfil för framtida användning
                try {
                  const configPath = path.join(__dirname, 'config.json');
                  let config = {};
                  
                  // Läs befintlig konfiguration om den finns
                  if (fs.existsSync(configPath)) {
                    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                  }
                  
                  // Uppdatera konfigurationen med det nya kalender-ID:t
                  config.calendarId = result.calendarId;
                  
                  // Spara konfigurationen
                  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
                  console.log('Calendar ID saved to config.json');
                } catch (configError) {
                  console.error('Error saving calendar ID to config:', configError);
                }
              } else {
                await client.createPost({
                  channel_id: post.channel_id,
                  message: `## ❌ Kunde inte skapa kalender\n\nFel: ${result.error}`,
                  ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
                });
              }
            } catch (error) {
              console.error('Error handling create-calendar command:', error);
              await client.createPost({
                channel_id: post.channel_id,
                message: 'Ett fel uppstod vid skapande av kalender.',
                ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
              });
            }
            
            return;
          }
          
          try {
            console.log('Skickar förfrågan till Gemini...');
            // Skicka förfrågan till Gemini
            const result = await model.generateContent(cleanMessage);
            const response = result.response.text();
            
            console.log('Svar mottaget från Gemini');
            console.log('Gemini svar:', response);
            
            // Svara i Mattermost
            console.log('Skickar svar till Mattermost...');
await client.createPost({
  channel_id: post.channel_id,
  message: response,
  ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }), // Kontrollera om root_id finns, annars använd post.id
});

            console.log('Svar skickat till Mattermost');
          } catch (error) {
            console.error('Fel vid generering eller sändning av svar:', error);
            
            // Försök skicka ett felmeddelande till användaren
            try {
              await client.createPost({
                channel_id: post.channel_id,
                message: 'Jag kunde tyvärr inte generera ett svar just nu. Om det gäller en brådskande styrelsefråga, vänligen kontakta ordförande eller sekreterare direkt.',
                root_id: post.id,
              });
            } catch (postError) {
              console.error('Kunde inte skicka felmeddelande:', postError);
            }
          }
        }
      } catch (parseError) {
        console.error('Fel vid parsning av meddelande:', parseError);
      }
    }
  } catch (error) {
    console.error('Fel vid hantering av meddelande:', error);
  }
}

// Funktion för att ansluta WebSocket med återanslutningslogik
function connectWebSocket() {
  console.log('Ansluter till Mattermost WebSocket...');
  
  const wsUrl = `${MM_SERVER_URL.replace('http', 'ws')}/api/v4/websocket`;
  console.log('WebSocket URL:', wsUrl);
  
  const ws = new WebSocket(wsUrl);
  
  ws.on('open', () => {
    console.log('WebSocket anslutning öppnad');
    
    // Autentisera med Mattermost
    const authMessage = {
      seq: 1,
      action: 'authentication_challenge',
      data: { token: MM_BOT_TOKEN }
    };
    
    ws.send(JSON.stringify(authMessage));
    console.log('Autentiseringsförfrågan skickad');
  });
  
  ws.on('message', async (data) => {
    try {
      await handleMessage(data);
    } catch (error) {
      console.error('Fel vid hantering av meddelande:', error);
    }
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket fel:', error);
  });
  
  ws.on('close', (code, reason) => {
    console.log(`WebSocket stängd med kod ${code} och anledning: ${reason}`);
    console.log('Försöker återansluta om 5 sekunder...');
    
    // Återanslut efter 5 sekunder
    setTimeout(connectWebSocket, 5000);
  });
  
  return ws;
}

// Starta boten
try {
  console.log('Gemini-bot för Mattermost startar...');
  
  // Testa Mattermost-anslutning
  async function setOnlineStatus() {
    try {
      // Get the bot's user ID
      const me = await client.getMe();
      const botId = me.id;
      
      // Use the updateStatus method instead of updateUserStatus
      await client.updateStatus({
        user_id: botId,
        status: 'online'
      });
      
      console.log('Bot status set to online');
    } catch (error) {
      console.error('Failed to update bot status:', error);
    }
  }

  // Call this function periodically
  function maintainOnlineStatus() {
    setOnlineStatus();
    // Update status every 5 minutes
    setTimeout(maintainOnlineStatus, 5 * 60 * 1000);
  }

  // Start the status updates when the bot connects
  client.getMe()
    .then(me => {
      console.log('Ansluten till Mattermost som:', me.username);
      
      // Set initial online status
      setOnlineStatus();
      
      // Start periodic status updates
      maintainOnlineStatus();
      
      // Anslut WebSocket efter lyckad Mattermost-anslutning
      connectWebSocket();
    })
    .catch(error => {
      console.error('Kunde inte ansluta till Mattermost:', error);
      process.exit(1);
    });
    
} catch (error) {
  console.error('Fel vid start av bot:', error);
  process.exit(1);
}

// Hantera programavslut
process.on('SIGINT', () => {
  console.log('Bot avslutas...');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('Ohanterat undantag:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Ohanterad avvisning vid:', promise, 'anledning:', reason);
});
