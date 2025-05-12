const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

// Filsökväg för att lagra mötesinformation
const MEETINGS_FILE = path.join(__dirname, 'meetings.json');

// Credentials path - make sure this points to your Google API credentials file
const CREDENTIALS_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, 'google-credentials.json');

// Set up authentication for Google APIs
let auth;
try {
  console.log('Initializing Google Calendar authentication...');
  console.log('Using credentials from:', CREDENTIALS_PATH);
  
  // För service account autentisering
  auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_PATH,
    scopes: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events'
    ]
  });
  
  console.log('Google Calendar authentication initialized with service account');
  
  // Testa autentiseringen direkt
  auth.getClient().then(client => {
    console.log('Successfully obtained auth client');
  }).catch(error => {
    console.error('Error obtaining auth client:', error);
  });
} catch (error) {
  console.error('Error initializing Google Calendar authentication:', error);
}

// Struktur för att lagra möten i minnet
let meetings = [];

// Ladda befintliga möten från fil
function loadMeetings() {
  try {
    if (fs.existsSync(MEETINGS_FILE)) {
      meetings = JSON.parse(fs.readFileSync(MEETINGS_FILE, 'utf8'));
      console.log(`Laddade ${meetings.length} möten från fil`);
    }
  } catch (error) {
    console.error('Fel vid laddning av möten:', error);
    meetings = [];
  }
}

// Spara möten till fil
function saveMeetings() {
  try {
    fs.writeFileSync(MEETINGS_FILE, JSON.stringify(meetings, null, 2), 'utf8');
    console.log(`Sparade ${meetings.length} möten till fil`);
  } catch (error) {
    console.error('Fel vid sparande av möten:', error);
  }
}

/**
 * Skapa ett nytt möte
 * @param {Object} meetingData - Information om mötet
 * @returns {Object} - Det skapade mötet
 */
async function createMeeting(meetingData) {
  try {
    // Generera ett unikt ID för mötet
    const meetingId = Date.now().toString();
    
    // Skapa mötesstruktur
    const meeting = {
      id: meetingId,
      title: meetingData.title,
      description: meetingData.description || '',
      date: meetingData.date,
      time: meetingData.time || '18:00',
      location: meetingData.location || 'Online',
      organizer: meetingData.organizer || 'Styrelsen',
      attendees: meetingData.attendees || [],
      channel_id: meetingData.channel_id,
      reminder_sent: false,
      created_at: new Date().toISOString()
    };
    
    // Lägg till mötet i listan
    meetings.push(meeting);
    
    // Spara till fil
    saveMeetings();
    
    // Om Google Calendar-integration är aktiverad, skapa även ett kalenderevent
    let calendarResult = { success: false };
    if (meetingData.addToCalendar) {
      try {
        console.log('Attempting to add meeting to Google Calendar...');
        calendarResult = await addToGoogleCalendar(meeting);
        
        if (calendarResult.success) {
          console.log('Successfully added meeting to Google Calendar');
        } else {
          console.warn('Could not add meeting to Google Calendar:', calendarResult.error);
        }
      } catch (calendarError) {
        console.error('Error adding meeting to Google Calendar:', calendarError);
        calendarResult = { 
          success: false, 
          error: calendarError.message 
        };
      }
    }
    
    return { 
      success: true, 
      meeting,
      calendarAdded: calendarResult.success,
      calendarLink: calendarResult.calendarLink,
      calendarError: calendarResult.error
    };
  } catch (error) {
    console.error('Fel vid skapande av möte:', error);
    return { success: false, error: error.message };
  }
}


/**
 * Lägg till möte i Google Calendar
 * @param {Object} meeting - Mötesinformation
 * @returns {Object} - Kalenderhändelseinformation
 */
async function addToGoogleCalendar(meeting) {
  try {
    if (!auth) {
      throw new Error('Google Calendar authentication not initialized');
    }
    
    // Hämta kalender-ID från konfigurationen
    let calendarId = 'primary';  // Standardvärde
    try {
      const configPath = path.join(__dirname, 'config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.calendarId) {
          calendarId = config.calendarId;
          console.log('Using calendar ID from config:', calendarId);
        }
      }
    } catch (configError) {
      console.error('Error reading calendar ID from config:', configError);
    }
    
    console.log('Attempting to get auth client...');
    const authClient = await auth.getClient();
    console.log('Auth client obtained successfully');
    
    const calendar = google.calendar({ version: 'v3', auth: authClient });
    
    // Formatera datum och tid
    const [year, month, day] = meeting.date.split('-').map(num => parseInt(num));
    const [hours, minutes] = meeting.time.split(':').map(num => parseInt(num));
    
    const startDateTime = new Date(year, month - 1, day, hours, minutes);
    const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000); // 1 timme senare
    
    console.log('Creating calendar event for:', meeting.title);
    console.log('Start time:', startDateTime.toISOString());
    console.log('End time:', endDateTime.toISOString());
    console.log('Using calendar ID:', calendarId);
    
    // Skapa kalenderhändelse
    const event = {
      summary: meeting.title,
      description: meeting.description,
      location: meeting.location,
      start: {
        dateTime: startDateTime.toISOString(),
        timeZone: 'Europe/Stockholm',
      },
      end: {
        dateTime: endDateTime.toISOString(),
        timeZone: 'Europe/Stockholm',
      },
      reminders: {
        useDefault: true
      },
    };
    
    console.log('Attempting to insert event into calendar...');
    const response = await calendar.events.insert({
      calendarId: calendarId,
      resource: event,
      sendUpdates: 'none',
    });
    
    console.log('Event created successfully:', response.data.htmlLink);
    
    // Uppdatera mötet med kalenderlänk
    const meetingIndex = meetings.findIndex(m => m.id === meeting.id);
    if (meetingIndex !== -1) {
      meetings[meetingIndex].calendar_link = response.data.htmlLink;
      saveMeetings();
    }
    
    return { success: true, calendarLink: response.data.htmlLink };
  } catch (error) {
    console.error('Fel vid tillägg i Google Calendar:', error);
    if (error.response) {
      console.error('Error response:', error.response.data);
    }
    return { success: false, error: error.message };
  }
}

/**
 * Hämta alla kommande möten
 * @returns {Array} - Lista med kommande möten
 */
function getUpcomingMeetings() {
  const now = new Date();
  
  return meetings.filter(meeting => {
    const [year, month, day] = meeting.date.split('-').map(num => parseInt(num));
    const [hours, minutes] = meeting.time.split(':').map(num => parseInt(num));
    const meetingDate = new Date(year, month - 1, day, hours, minutes);
    
    return meetingDate > now;
  }).sort((a, b) => {
    const dateA = new Date(`${a.date}T${a.time}`);
    const dateB = new Date(`${b.date}T${b.time}`);
    return dateA - dateB;
  });
}

/**
 * Hämta möten som behöver påminnelser
 * @param {number} daysBeforeReminder - Antal dagar innan mötet för påminnelse
 * @returns {Array} - Lista med möten som behöver påminnelser
 */
function getMeetingsNeedingReminders(daysBeforeReminder = 7) {
  const now = new Date();
  const reminderThreshold = new Date();
  reminderThreshold.setDate(reminderThreshold.getDate() + daysBeforeReminder);
  
  return meetings.filter(meeting => {
    // Skippa möten som redan har fått påminnelse
    if (meeting.reminder_sent) return false;
    
    const [year, month, day] = meeting.date.split('-').map(num => parseInt(num));
    const meetingDate = new Date(year, month - 1, day);
    
    // Kontrollera om mötet är inom påminnelseperioden men inte har passerat
    return meetingDate <= reminderThreshold && meetingDate > now;
  });
}

/**
 * Markera ett möte som påmint
 * @param {string} meetingId - ID för mötet
 */
function markReminderSent(meetingId) {
  const meetingIndex = meetings.findIndex(m => m.id === meetingId);
  if (meetingIndex !== -1) {
    meetings[meetingIndex].reminder_sent = true;
    saveMeetings();
  }
}

/**
 * Ta bort ett möte
 * @param {string} meetingId - ID för mötet
 * @returns {boolean} - Om borttagningen lyckades
 */
function deleteMeeting(meetingId) {
  const initialLength = meetings.length;
  meetings = meetings.filter(meeting => meeting.id !== meetingId);
  
  if (meetings.length < initialLength) {
    saveMeetings();
    return true;
  }
  
  return false;
}

/**
 * Uppdatera ett möte
 * @param {string} meetingId - ID för mötet
 * @param {Object} updateData - Ny information för mötet
 * @returns {Object} - Det uppdaterade mötet
 */
function updateMeeting(meetingId, updateData) {
  const meetingIndex = meetings.findIndex(m => m.id === meetingId);
  
  if (meetingIndex === -1) {
    return { success: false, error: 'Mötet hittades inte' };
  }
  
  // Uppdatera mötesdata
  meetings[meetingIndex] = {
    ...meetings[meetingIndex],
    ...updateData,
    updated_at: new Date().toISOString()
  };
  
  saveMeetings();
  
  return { success: true, meeting: meetings[meetingIndex] };
}

// Funktion för att testa kalenderbehörigheter
async function testCalendarAccess() {
  try {
    if (!auth) {
      throw new Error('Google Calendar authentication not initialized');
    }
    
    const authClient = await auth.getClient();
    const calendar = google.calendar({ version: 'v3', auth: authClient });
    
    // Försök lista kalendrar
    console.log('Attempting to list calendars...');
    const response = await calendar.calendarList.list();
    
    console.log('Successfully listed calendars:');
    response.data.items.forEach(cal => {
      console.log(`- ${cal.summary} (${cal.id})`);
    });
    
    return { success: true, calendars: response.data.items };
  } catch (error) {
    console.error('Error testing calendar access:', error);
    if (error.response) {
      console.error('Error response:', error.response.data);
    }
    return { success: false, error: error.message };
  }
}

// Ladda möten vid start
loadMeetings();

// Skapar en ny kalender och delar den med en specifik användare
/* @param {string} calendarName - Namnet på kalendern
 * @param {string} shareWithEmail - E-postadressen att dela kalendern med
 * @returns {Promise<Object>} - Resultat med kalender-ID
 */
async function createAndShareCalendar(calendarName, shareWithEmail) {
  try {
    if (!auth) {
      throw new Error('Google Calendar authentication not initialized');
    }
    
    console.log(`Attempting to create calendar "${calendarName}" and share with ${shareWithEmail}...`);
    
    const authClient = await auth.getClient();
    const calendar = google.calendar({ version: 'v3', auth: authClient });
    
    // 1. Skapa en ny kalender
    const newCalendar = await calendar.calendars.insert({
      requestBody: {
        summary: calendarName,
        description: 'Kalender skapad av Elevkårens mötessystem',
        timeZone: 'Europe/Stockholm'
      }
    });
    
    console.log('Calendar created:', newCalendar.data);
    const calendarId = newCalendar.data.id;
    
    // 2. Dela kalendern med den angivna e-postadressen
    const acl = await calendar.acl.insert({
      calendarId: calendarId,
      requestBody: {
        role: 'owner',  // Ge full behörighet (owner, writer, reader)
        scope: {
          type: 'user',
          value: shareWithEmail
        }
      }
    });
    
    console.log('Calendar shared successfully:', acl.data);
    
    return { 
      success: true, 
      calendarId: calendarId, 
      calendarName: newCalendar.data.summary 
    };
  } catch (error) {
    console.error('Error creating and sharing calendar:', error);
    if (error.response) {
      console.error('Error response:', error.response.data);
    }
    return { success: false, error: error.message };
  }
}

// Exportera testfunktionen
module.exports = {
  createMeeting,
  getUpcomingMeetings,
  getMeetingsNeedingReminders,
  markReminderSent,
  deleteMeeting,
  updateMeeting,
  testCalendarAccess,
  createAndShareCalendar  // Lägg till denna
};