// Netlify serverless function to send SMS via Twilio
const twilio = require('twilio');

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Parse request body
    const { 
      studentName, 
      tutorName, 
      instrument, 
      date, 
      startTime, 
      durationMin, 
      recipientPhone,
      messageType = 'confirmation' 
    } = JSON.parse(event.body);

    // Get Twilio credentials from environment variables
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioPhone = process.env.TWILIO_PHONE_NUMBER;

    if (!accountSid || !authToken || !twilioPhone) {
      throw new Error('Twilio credentials not configured');
    }

    // Initialize Twilio client
    const client = twilio(accountSid, authToken);

    // Format date and time for message
    const formattedDate = new Date(date).toLocaleDateString('en-AU', { 
      weekday: 'short', 
      day: 'numeric', 
      month: 'short' 
    });
    
    const formattedTime = startTime.replace(/^(\d+):(\d+)$/, (match, h, m) => {
      const hour = parseInt(h);
      const suffix = hour >= 12 ? 'pm' : 'am';
      const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
      return `${displayHour}:${m}${suffix}`;
    });

    // Build message based on type
    let messageBody;
    if (messageType === 'reminder') {
      messageBody = `Reminder: ${studentName}'s ${instrument} lesson with ${tutorName} starts in 2 hours (${formattedTime} today). Questions? Call 0421 272 477.`;
    } else {
      messageBody = `Manly Music: ${studentName}'s ${instrument} lesson with ${tutorName} is confirmed for ${formattedDate} at ${formattedTime} (${durationMin} min). Questions? Call 0421 272 477.`;
    }

    // Send SMS
    const message = await client.messages.create({
      body: messageBody,
      from: twilioPhone,
      to: recipientPhone
    });

    // Return success
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        messageSid: message.sid,
        status: message.status,
        message: messageBody
      })
    };

  } catch (error) {
    console.error('SMS Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};
