const express = require('express');
const axios = require('axios');
const path = require('path');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const { Parser } = require('json2csv'); // Convert JSON to CSV

const app = express();
const port = 3000;

// Middleware to parse JSON and form data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
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

// Dummy database (Replace with actual database later)
let paymentRecords = [];

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

        // Store payment details in the dummy database
        paymentRecords.push({
            teamName,
            email,
            amount,
            payment_url: response.data.payment_request.longurl,
            uniqueKey,
            status: 'Initiated'
        });

        // Send email confirmation
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
        // Find the payment record
        const paymentIndex = paymentRecords.findIndex(record => record.uniqueKey === uniqueKey);
        if (paymentIndex === -1) return res.status(404).send('Payment not found');

        // Verify the payment with Instamojo
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

                // Update payment status
                paymentRecords[paymentIndex].status = paymentStatus === 'Credit' ? 'Paid' : paymentStatus;
                paymentRecords[paymentIndex].paymentId = paymentId;

                // Send confirmation email
                if (paymentStatus === 'Credit') {
                    await transporter.sendMail({
                        from: 'STARTUPSPARK@RAJALAKSHMI.EDU.IN',
                        to: paymentRecords[paymentIndex].email,
                        subject: 'Payment Successful - Hackathon Registration Confirmed',
                        text: `Dear ${paymentRecords[paymentIndex].teamName}, your payment has been successfully processed. Your Payment ID is: ${paymentId} and Unique Key is: ${uniqueKey}.`,
                    });
                }

                return res.redirect(`/?status=success&payment_id=${paymentId}`);
            } catch (error) {
                console.error('Error verifying payment:', error);
                return res.redirect('/?status=error&message=payment_verification_failed');
            }
        } else {
            paymentRecords[paymentIndex].status = 'Pending';
            return res.redirect('/?status=pending');
        }
    } catch (error) {
        console.error('Error processing payment success:', error);
        return res.status(500).send('An error occurred while processing your payment. Please contact support.');
    }
});

// API endpoint to check payment status
app.get('/api/payment-status/:uniqueKey', (req, res) => {
    const uniqueKey = req.params.uniqueKey;
    const payment = paymentRecords.find(record => record.uniqueKey === uniqueKey);

    if (!payment) {
        return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    res.json({ success: true, status: payment.status, paymentId: payment.paymentId });
});

// Route to generate and download CSV
app.get('/Tonyiwill-meetyou', (req, res) => {
    try {
        const fields = ['teamName', 'email', 'amount', 'status', 'paymentId'];
        const json2csvParser = new Parser({ fields });
        const csv = json2csvParser.parse(paymentRecords);

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=payments.csv');
        res.send(csv);
    } catch (error) {
        console.error('Error generating CSV:', error);
        res.status(500).send('Error generating CSV file');
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
