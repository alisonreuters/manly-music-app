// Netlify Function: create-booking
// Handles new lesson bookings from public website

const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const {
      tutorId,
      date,
      time,
      studentName,
      studentEmail,
      studentPhone,
      instrument,
      package: packageType,
      amount
    } = JSON.parse(event.body);

    // Validate required fields
    if (!tutorId || !date || !time || !studentName || !studentEmail || !amount) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required fields' })
      };
    }

    // Create Stripe Payment Intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount, // Amount in cents
      currency: 'aud',
      metadata: {
        tutorId,
        date,
        time,
        studentName,
        studentEmail,
        instrument,
        packageType
      },
      description: `${packageType === 'single' ? 'Single Lesson' : '10-Lesson Package'} - ${studentName}`
    });

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
          password: 'temp_' + Math.random().toString(36).slice(2) // Temp password, send reset email
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
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .insert([{
        student_id: student.id,
        tutor_id: tutorId,
        date: date,
        start_time: time,
        end_time: endTime,
        duration_min: 30,
        instrument: instrument,
        status: 'scheduled',
        payment_status: 'paid', // Immediately set to paid since they're paying upfront
        payment_code: packageType === 'single' ? 'S' : 'C',
        payment_received_at: new Date().toISOString(),
        planned_summary: packageType === 'package' ? 'Part of 10-lesson package' : 'Single lesson booking',
        sms_confirmation_sent: false
      }])
      .select()
      .single();

    if (sessionError) throw sessionError;

    // Send SMS confirmation
    try {
      await fetch(process.env.URL + '/.netlify/functions/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentName: studentName,
          tutorName: 'Manly Music', // Will look up actual tutor name
          instrument: instrument,
          date: date,
          startTime: time,
          durationMin: 30,
          recipientPhone: studentPhone,
          messageType: 'confirmation'
        })
      });

      // Update session as SMS sent
      await supabase
        .from('sessions')
        .update({
          sms_confirmation_sent: true,
          sms_confirmation_sent_at: new Date().toISOString()
        })
        .eq('id', session.id);
    } catch (smsError) {
      console.error('SMS send failed:', smsError);
      // Don't fail the booking if SMS fails
    }

    // Return client secret for Stripe payment
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        clientSecret: paymentIntent.client_secret,
        sessionId: session.id,
        studentId: student.id
      })
    };

  } catch (error) {
    console.error('Booking error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
