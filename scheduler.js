const { getMeetingsNeedingReminders, markReminderSent } = require('./meeting-manager');

/**
 * Skicka påminnelser för kommande möten
 * @param {Object} client - Mattermost-klient
 * @param {number} daysBeforeReminder - Antal dagar innan mötet för påminnelse
 */
async function sendMeetingReminders(client, daysBeforeReminder = 7) {
  try {
    console.log('Kontrollerar möten som behöver påminnelser...');
    
    const meetingsNeedingReminders = getMeetingsNeedingReminders(daysBeforeReminder);
    console.log(`Hittade ${meetingsNeedingReminders.length} möten som behöver påminnelser`);
    
    for (const meeting of meetingsNeedingReminders) {
      try {
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
        
        console.log(`Skickade påminnelse för möte: ${meeting.title}`);
        
        // Markera mötet som påmint
        markReminderSent(meeting.id);
      } catch (error) {
        console.error(`Fel vid skickande av påminnelse för möte ${meeting.id}:`, error);
      }
    }
  } catch (error) {
    console.error('Fel vid kontroll av mötespåminnelser:', error);
  }
}

/**
 * Starta schemaläggaren för påminnelser
 * @param {Object} client - Mattermost-klient
 * @param {number} checkIntervalHours - Hur ofta kontrollera påminnelser (i timmar)
 */
function startReminderScheduler(client, checkIntervalHours = 12) {
  console.log(`Startar schemaläggare för mötespåminnelser, kontrollerar var ${checkIntervalHours} timme`);
  
  // Kör direkt vid start
  sendMeetingReminders(client);
  
  // Schemalägg regelbundna kontroller
  const intervalMs = checkIntervalHours * 60 * 60 * 1000;
  setInterval(() => sendMeetingReminders(client), intervalMs);
}

module.exports = {
  sendMeetingReminders,
  startReminderScheduler
};