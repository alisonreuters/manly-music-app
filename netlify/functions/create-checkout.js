// Netlify Function: create-checkout
// Creates Stripe Checkout session and redirects user to payment page

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
      tutorName,
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

    // Format date nicely
    const formattedDate = new Date(date).toLocaleDateString('en-AU', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      success_url: `${process.env.URL}/booking.html?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.URL}/booking.html?canceled=true`,
      customer_email: studentEmail,
      line_items: [
        {
          price_data: {
            currency: 'aud',
            product_data: {
              name: packageType === 'single' ? 'Music Lesson - Single Session' : 'Music Lesson - 10 Pack',
              description: `${instrument} lesson with ${tutorName} on ${formattedDate} at ${time}`,
              images: [], // Add your logo URL here if you have one
            },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      metadata: {
        tutorId: tutorId.toString(),
        tutorName,
        date,
        time,
        studentName,
        studentEmail,
        studentPhone,
        instrument,
        packageType,
      },
    });

    // Return checkout URL
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        checkoutUrl: session.url
      })
    };

  } catch (error) {
    console.error('Checkout creation error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
