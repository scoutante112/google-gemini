require('dotenv').config();
const { Client4 } = require('@mattermost/client');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const WebSocket = require('ws');
const introducedChannels = new Set();
const { searchDrive, getDocContent, getFolderName, DEFAULT_FOLDER_ID, summarizeDocument } = require('./drive-search');

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

  '/hjälp': `**Tillgängliga kommandon:**
- /dagordning - Genererar en mall för dagordning
- /protokoll - Genererar en mall för mötesprotokoll
- /budget - Genererar en budgetmall
- /checklista - Genererar en checklista för evenemang
- /hjälp - Visar denna hjälptext

Du kan också ställa frågor om styrelsearbete, planering, eller be om hjälp med formuleringar för kommunikation.`,

  '/checklista': `# Checklista för evenemang

## Före evenemang
- [ ] Fastställ datum och tid
- [ ] Boka lokal
- [ ] Skapa budget
- [ ] Marknadsför på sociala medier
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
            
            try {
              // Get the user's information to personalize the greeting
              const user = await client.getUser(post.user_id);
              const userName = user.first_name || user.username; // Use first name if available, otherwise username
              
              // Send personalized welcome message
              await client.createPost({
                channel_id: post.channel_id,
                message: `Hej ${userName}! Jag är er AI-assistent för styrelsearbetet. Jag kan hjälpa till med att generera mallar, svara på frågor om styrelsearbete, och assistera med planering. Skriv \`/hjälp\` för att se tillgängliga kommandon.`,
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
              await client.createPost({
                channel_id: post.channel_id,
                message: boardCommands[command],
                ...(post.root_id ? { root_id: post.root_id } : { root_id: post.id }),
              });
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
