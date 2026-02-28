// Netlify Function: stripe-webhook
// Handles Stripe events (payment success, etc.) and creates session in database

const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// IMPORTANT: Get this from Stripe Dashboard → Webhooks after you create the webhook
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];

  let stripeEvent;

  try {
    // Verify webhook signature
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, endpointSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return {
      statusCode: 400,
      body: `Webhook Error: ${err.message}`
    };
  }

  // Handle the event
  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    
    try {
      // Extract metadata
      const {
        tutorId,
        tutorName,
        date,
        time,
        studentName,
        studentEmail,
        studentPhone,
        instrument,
        packageType
      } = session.metadata;

      console.log('Processing successful payment:', { studentName, date, time });

      // Check if student exists, if not create
      let student;
      const { data: existingStudent } = await supabase
        .from('users')
        .select('*')
        .eq('email', studentEmail)
        .single();

      if (existingStudent) {
        student = existingStudent;
      } else {
        // Create new student
        const { data: newStudent, error: studentError } = await supabase
          .from('users')
          .insert([{
            name: studentName,
            email: studentEmail,
            mobile: studentPhone,
            role: 'student',
            password: 'temp_' + Math.random().toString(36).slice(2)
          }])
          .select()
          .single();

        if (studentError) throw studentError;
        student = newStudent;
      }

      // Calculate end time (30 min lesson)
      const [hours, minutes] = time.split(':').map(Number);
      const endMinutes = (hours * 60 + minutes + 30);
      const endHours = Math.floor(endMinutes / 60);
      const endMins = endMinutes % 60;
      const endTime = `${String(endHours).padStart(2, '0')}:${String(endMins).padStart(2, '0')}`;

      // Create session in database
      const { data: lessonSession, error: sessionError } = await supabase
        .from('sessions')
        .insert([{
          student_id: student.id,
          tutor_id: parseInt(tutorId),
          date: date,
          start_time: time,
          end_time: endTime,
          duration_min: 30,
          instrument: instrument,
          status: 'scheduled',
          payment_status: 'paid',
          payment_code: packageType === 'single' ? 'S' : 'C',
          payment_received_at: new Date().toISOString(),
          planned_summary: packageType === 'package' 
            ? 'Part of 10-lesson package - online booking' 
            : 'Single lesson - online booking',
          sms_confirmation_sent: false
        }])
        .select()
        .single();

      if (sessionError) throw sessionError;

      console.log('Session created:', lessonSession.id);

      // Send SMS confirmation with receipt info
      try {
        const smsResponse = await fetch(process.env.URL + '/.netlify/functions/send-sms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studentName: studentName,
            tutorName: tutorName,
            instrument: instrument,
            date: date,
            startTime: time,
            durationMin: 30,
            recipientPhone: studentPhone,
            studentEmail: studentEmail,
            messageType: 'confirmation_with_receipt'
          })
        });

        if (smsResponse.ok) {
          // Update session as SMS sent
          await supabase
            .from('sessions')
            .update({
              sms_confirmation_sent: true,
              sms_confirmation_sent_at: new Date().toISOString()
            })
            .eq('id', lessonSession.id);
          
          console.log('SMS sent successfully');
        } else {
          console.error('SMS send failed');
        }
      } catch (smsError) {
        console.error('SMS error:', smsError);
        // Don't fail the whole process if SMS fails
      }

      console.log('Booking complete!');

    } catch (error) {
      console.error('Error creating session:', error);
      // Payment succeeded but session creation failed
      // You might want to send an alert email here
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Session creation failed' })
      };
    }
  }

  // Return success to Stripe
  return {
    statusCode: 200,
    body: JSON.stringify({ received: true })
  };
};
