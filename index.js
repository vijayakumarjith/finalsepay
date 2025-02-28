const express = require('express');
const axios = require('axios');
const path = require('path');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const app = express();
const port = 3000;

// Firebase setup
const serviceAccount = require('./firebase-adminsdk.json');
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://edcrec-1b825-default-rtdb.firebaseio.com'
});
const db = admin.firestore();

// Middleware to parse JSON and form data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files (e.g., CSS, JS)
app.use(express.static(path.join(__dirname, 'dist')));

// Instamojo API credentials
const API_KEY = 'e0c97f7f54762e076c7ee1afe2e0378c';
const AUTH_TOKEN = '34c93658e03618e7efe91c588f751ec2';
const INSTAMOJO_BASE_URL = 'https://www.instamojo.com/api/1.1';

// Nodemailer setup
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'STARTUPSPARK@RAJALAKSHMI.EDU.IN',
        pass: 'tnqu avzx nmit iipm'
    }
});

// Route to serve the HTML form
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Endpoint to create a payment request
app.post('/create-payment', async (req, res) => {
    const { teamName, email, amount } = req.body;
    const uniqueKey = crypto.randomBytes(16).toString('hex');

    try {
        const response = await axios.post(
            `${INSTAMOJO_BASE_URL}/payment-requests/`,
            {
                purpose: `Hackathon Team Registration: ${teamName}`,
                amount: amount,
                buyer_name: teamName,
                email: email,
                redirect_url: `http://localhost:3000/payment-success?unique_key=${uniqueKey}`,
                send_email: true,
                allow_repeated_payments: false,
            },
            {
                headers: {
                    "X-Api-Key": API_KEY,
                    "X-Auth-Token": AUTH_TOKEN,
                },
            }
        );

        // Store payment details in Firebase
        await db.collection('payments').doc(uniqueKey).set({
            teamName,
            email,
            amount,
            payment_url: response.data.payment_request.longurl,
            uniqueKey,
            status: 'Initiated',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Send email confirmation with better formatting
        const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 5px;">
                <h2 style="color: #4a5568; text-align: center;">Hackathon Registration Payment</h2>
                <p>Dear <strong>${teamName}</strong>,</p>
                <p>Your payment for the Hackathon Registration has been initiated.</p>
                <p><strong>Your unique participation key is:</strong> ${uniqueKey}</p>
                <p>Please complete your payment by clicking the button below:</p>
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${response.data.payment_request.longurl}" style="background-color: #4299e1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;">Complete Payment</a>
                </div>
                <p>If you have any questions, please contact our support team.</p>
                <p>Thank you,<br>The Hackathon Team</p>
            </div>
        `;

        await transporter.sendMail({
            from: 'STARTUPSPARK@RAJALAKSHMI.EDU.IN',
            to: email,
            subject: 'Payment Initiated for Hackathon Registration',
            text: `Dear ${teamName}, your payment has been initiated. Your unique participation key is: ${uniqueKey}. Complete your payment here: ${response.data.payment_request.longurl}`,
            html: emailHtml
        });

        res.json({ success: true, payment_url: response.data.payment_request.longurl });
    } catch (error) {
        console.error('Error creating payment request:', error.response ? error.response.data : error.message);
        res.status(500).json({ success: false, message: 'Payment request failed' });
    }
});

// Route to handle payment success
app.get('/payment-success', async (req, res) => {
    const paymentId = req.query.payment_id;
    const uniqueKey = req.query.unique_key;
    
    if (!uniqueKey) {
        return res.status(400).send('Invalid payment confirmation: Missing unique key.');
    }
    
    try {
        // Verify the payment with Instamojo if payment_id exists
        if (paymentId) {
            try {
                const paymentVerification = await axios.get(
                    `https://www.instamojo.com/api/1.1/payments/${paymentId}/`,
                    {
                        headers: {
                            'X-Api-Key': API_KEY,
                            'X-Auth-Token': AUTH_TOKEN,
                        },
                    }
                );
                
                const paymentStatus = paymentVerification.data.payment.status;
                
                // Update the payment status in Firebase
                await db.collection('payments').doc(uniqueKey).update({ 
                    status: paymentStatus === 'Credit' ? 'Paid' : paymentStatus,
                    paymentId,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                
                // Get team details for email
                const paymentDoc = await db.collection('payments').doc(uniqueKey).get();
                const paymentData = paymentDoc.data();
                
                if (paymentData && paymentStatus === 'Credit') {
                    // Send confirmation email
                    const confirmationEmailHtml = `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 5px;">
                            <h2 style="color: #4a5568; text-align: center;">Payment Successful!</h2>
                            <p>Dear <strong>${paymentData.teamName}</strong>,</p>
                            <p>Your payment for the Hackathon Registration has been successfully processed.</p>
                            <p><strong>Payment Details:</strong></p>
                            <ul>
                                <li>Amount: ₹${paymentData.amount}</li>
                                <li>Payment ID: ${paymentId}</li>
                                <li>Unique Key: ${uniqueKey}</li>
                            </ul>
                            <p>You are now officially registered for the hackathon. We look forward to seeing your innovative ideas!</p>
                            <p>Thank you,<br>The Hackathon Team</p>
                        </div>
                    `;
                    
                    await transporter.sendMail({
                        from: 'STARTUPSPARK@RAJALAKSHMI.EDU.IN',
                        to: paymentData.email,
                        subject: 'Payment Successful - Hackathon Registration Confirmed',
                        text: `Dear ${paymentData.teamName}, your payment of ₹${paymentData.amount} has been successfully processed. Your Payment ID is: ${paymentId} and Unique Key is: ${uniqueKey}. You are now officially registered for the hackathon.`,
                        html: confirmationEmailHtml
                    });
                }
                
                // Redirect to success page with status
                return res.redirect(`/?status=success&payment_id=${paymentId}`);
            } catch (error) {
                console.error('Error verifying payment:', error);
                await db.collection('payments').doc(uniqueKey).update({ 
                    status: 'Verification Failed',
                    paymentId,
                    error: error.message,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                return res.redirect('/?status=error&message=payment_verification_failed');
            }
        } else {
            // If no payment_id, update as pending
            await db.collection('payments').doc(uniqueKey).update({ 
                status: 'Pending',
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            return res.redirect('/?status=pending');
        }
    } catch (error) {
        console.error('Error processing payment success:', error);
        return res.status(500).send('An error occurred while processing your payment. Please contact support.');
    }
});

// API endpoint to check payment status
app.get('/api/payment-status/:uniqueKey', async (req, res) => {
    try {
        const uniqueKey = req.params.uniqueKey;
        const doc = await db.collection('payments').doc(uniqueKey).get();
        
        if (!doc.exists) {
            return res.status(404).json({ success: false, message: 'Payment not found' });
        }
        
        const data = doc.data();
        return res.json({ success: true, status: data.status, paymentId: data.paymentId });
    } catch (error) {
        console.error('Error checking payment status:', error);
        return res.status(500).json({ success: false, message: 'Failed to check payment status' });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});