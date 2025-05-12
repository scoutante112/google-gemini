# Google Gemini Mattermost Bot

En AI-assistent för elevkårsstyrelser som integrerar Google Gemini med Mattermost.

## Beskrivning

Denna bot är designad för att hjälpa elevkårsstyrelser med deras dagliga arbete genom att tillhandahålla:

- Mallar för dagordningar, protokoll och budgetar
- Svar på vanliga styrelsefrågor
- AI-assistans för planering och dokumentation
- Checklistor för evenemang
- Sökning i Google Drive-dokument
- Sammanfattning av dokument med AI

Boten använder Google Gemini 2.0 Flash för att generera svar på frågor och är specifikt tränad för att hjälpa elevkårsstyrelser.

## Funktioner

- **Automatisk introduktion**: Boten presenterar sig själv med en personlig hälsning första gången den används i en ny kanal
- **Styrelsespecifika mallar**: Färdiga mallar för vanliga styrelsedokument
- **AI-assistans**: Svar på frågor om styrelsearbete med hjälp av Google Gemini
- **Trådhantering**: Boten svarar i samma tråd som den blir tillfrågad i
- **Google Drive-integration**: Sökning i styrelsens dokumentarkiv
- **Dokumentsammanfattning**: Sammanfattar långa dokument för snabb överblick

## Installation

### Förutsättningar

- Node.js (v14 eller senare)
- Mattermost-server med bot-konto
- Google Gemini API-nyckel
- Google Drive API-behörighet (för dokumentsökning och sammanfattning)

### Steg 1: Klona detta repository

```bash
git clone https://github.com/scoutante112/google-gemini.git
```

```bash
cd google-gemini
```

### Steg 2: Installera beroenden

```bash
npm install
```

### Steg 3: Konfigurera API-nycklar

Skapa en `.env`-fil med följande variabler:

```
MATTERMOST_BOT_TOKEN=ditt_bot_token_här
MATTERMOST_SERVER_URL=din_mattermost_server_url
GEMINI_API_KEY=din_gemini_api_nyckel
```

För Google Drive-integration, skapa en `google-credentials.json`-fil med dina Google API-uppgifter.

## Användning

### Starta boten

```bash
node index.js
```

För att hålla boten igång permanent, använd en process manager som PM2:

```bash
npm install -g pm2
pm2 start index.js --name "gemini-mattermost-bot"
pm2 startup
pm2 save
```

### Kommandon

Boten svarar på följande kommandon i Mattermost:

| Kommando | Beskrivning |
|----------|-------------|
| `/dagordning` | Genererar en mall för dagordning |
| `/protokoll` | Genererar en mall för mötesprotokoll |
| `/budget` | Genererar en budgetmall |
| `/checklista` | Genererar en checklista för evenemang |
| `/hjälp` | Visar hjälptext med tillgängliga kommandon |
| `ping` | Kontrollerar om boten är online |

### Google Drive-integration

Boten kan söka i styrelsens Google Drive-dokument:

```
sök efter stadgar
```

```
hitta budget 2023
```

### Dokumentsammanfattning

Boten kan sammanfatta dokument:

```
sammanfatta dokument https://docs.google.com/document/d/...
```

```
sammanfatta dokument Styrelsemötesprotokoll 2023-05-12
```

### Interaktion

Du kan interagera med boten på två sätt:
1. Genom att nämna boten i en kanal (`@botnamn`)
2. Genom direktmeddelanden till boten

## Teknisk information

- Använder Mattermost Client4 API för kommunikation med Mattermost
- Ansluter via WebSocket för realtidsmeddelanden
- Implementerar automatisk återanslutning vid avbrott
- Använder Google Generative AI för att generera svar
- Integrerar med Google Drive API för dokumentsökning och -sammanfattning

## Felsökning

### Vanliga problem

- **Boten svarar inte**: Kontrollera att WebSocket-anslutningen är aktiv
- **Boten visas som offline**: Detta är normalt, boten fungerar ändå
- **Google Drive-sökning fungerar inte**: Kontrollera att `google-credentials.json` är korrekt konfigurerad

### Loggning

Boten loggar detaljerad information om sin aktivitet. Kontrollera loggarna för att diagnostisera problem:

```bash
pm2 logs gemini-mattermost-bot
```

## Bidra

Bidrag till projektet är välkomna! Så här kan du bidra:

1. Forka repositoryt
2. Skapa en feature branch (`git checkout -b feature/amazing-feature`)
3. Commita dina ändringar (`git commit -m 'Add some amazing feature'`)
4. Pusha till branchen (`git push origin feature/amazing-feature`)
5. Öppna en Pull Request


## Kontakt

Projektansvarig: [Anton](mailto:anton@labnat.se)

Projektlänk: [https://github.com/scoutante112/google-gemini](https://github.com/scoutante112/google-gemini)

---

Utvecklad med ❤️ för elevkårsstyrelser
