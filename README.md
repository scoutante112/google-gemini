# Google Gemini Mattermost Bot

En AI-assistent för elevkårsstyrelser som integrerar Google Gemini med Mattermost.

## Beskrivning

Denna bot är designad för att hjälpa elevkårsstyrelser med deras dagliga arbete genom att tillhandahålla:

- Mallar för dagordningar, protokoll och budgetar
- Svar på vanliga styrelsefrågor
- AI-assistans för planering och dokumentation
- Checklistor för evenemang

Boten använder Google Gemini 2.0 Flash för att generera svar på frågor och är specifikt tränad för att hjälpa elevkårsstyrelser.

## Installation

1. Klona detta repository:
```bash
git clone https://github.com/scoutante112/google-gemini.git
```

```bash
cd google-gemini
```

```bash
npm install
```

2. Skapa en `.env`-fil med följande variabler:
```
MATTERMOST_BOT_TOKEN=ditt_bot_token_här
MATTERMOST_SERVER_URL=din_mattermost_server_url
GEMINI_API_KEY=din_gemini_api_nyckel
```

## Användning

Starta boten:

```bash
node index.js
```

### Kommandon

Boten svarar på följande kommandon i Mattermost:

- `/dagordning` - Genererar en mall för dagordning
- `/protokoll` - Genererar en mall för mötesprotokoll
- `/budget` - Genererar en budgetmall
- `/checklista` - Genererar en checklista för evenemang
- `/hjälp` - Visar hjälptext med tillgängliga kommandon

### Interaktion

Du kan interagera med boten på två sätt:
1. Genom att nämna boten i en kanal (`@botnamn`)
2. Genom direktmeddelanden till boten

## Funktioner

- **Automatisk introduktion**: Boten presenterar sig själv första gången den används i en ny kanal
- **Styrelsespecifika mallar**: Färdiga mallar för vanliga styrelsedokument
- **AI-assistans**: Svar på frågor om styrelsearbete med hjälp av Google Gemini
- **Trådhantering**: Boten svarar i samma tråd som den blir tillfrågad i

## Teknisk information

- Använder Mattermost Client4 API för kommunikation med Mattermost
- Ansluter via WebSocket för realtidsmeddelanden
- Implementerar automatisk återanslutning vid avbrott
- Använder Google Generative AI för att generera svar

## Krav

- Node.js
- Mattermost-server med bot-konto
- Google Gemini API-nyckel

## Felhantering

Boten inkluderar omfattande loggning och felhantering för att underlätta felsökning.