const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (user && pass) {
    transporter = nodemailer.createTransport({
      host: host || 'smtp.gmail.com',
      port: port,
      secure: port === 465, // true for 465, false for 587 or other ports
      auth: { user, pass },
      tls: {
        rejectUnauthorized: false // avoids self-signed or local certificate issues
      }
    });
    console.log(`✓ Nodemailer configured with SMTP user: ${user}`);
  }
  return transporter;
}

async function sendOtpEmail(toEmail, otp) {
  const mailTransporter = getTransporter();

  const isConfigured = !!mailTransporter && !!process.env.SMTP_USER && process.env.SMTP_USER !== 'your_gmail_or_smtp_username@gmail.com';

  if (!isConfigured) {
    // Development / Test mode fallback
    console.log('\n' + '='.repeat(50));
    console.log(`[PROTRACKR DEV EMAIL] OTP for ${toEmail}:`);
    console.log(`>>> OTP CODE:  ${otp}  <<<`);
    console.log('(Valid for 10 minutes. Add SMTP credentials to .env for real email dispatch.)');
    console.log('='.repeat(50) + '\n');

    return {
      success: true,
      devMode: true,
      otp: otp,
      message: 'OTP dispatched in local dev mode (logged to console and ready to enter)'
    };
  }

  const sender = process.env.SMTP_FROM || `"ProTrackR" <${process.env.SMTP_USER}>`;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { margin:0; padding:0; background:#050505; color:#ffffff; font-family:'Segoe UI',Roboto,Helvetica,sans-serif; }
        .container { max-width:480px; margin:30px auto; background:#111111; border:1px solid #222222; border-radius:12px; overflow:hidden; }
        .header { background:#0a0a0a; padding:24px; text-align:center; border-bottom:1px solid #222222; }
        .logo { font-size:22px; font-weight:900; letter-spacing:4px; color:#00f260; }
        .body { padding:30px; text-align:center; }
        .title { font-size:18px; font-weight:700; margin-bottom:12px; color:#ffffff; }
        .text { font-size:14px; color:#aaaaaa; line-height:1.6; margin-bottom:24px; }
        .otp-box { display:inline-block; letter-spacing:10px; font-size:32px; font-weight:900; color:#00f260; background:#161616; padding:16px 28px; border-radius:8px; border:1px solid #00f260; margin-bottom:24px; }
        .footer { background:#0a0a0a; padding:16px; text-align:center; font-size:11px; color:#555555; border-top:1px solid #222222; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo">PROTRACKR</div>
        </div>
        <div class="body">
          <div class="title">Email Verification</div>
          <p class="text">You are setting up your ProTrackR account. Enter the verification code below to confirm your email:</p>
          <div class="otp-box">${otp}</div>
          <p class="text" style="font-size:12px; color:#777777;">This code is valid for 10 minutes. If you did not request this, you can safely ignore this email.</p>
        </div>
        <div class="footer">
          &copy; ${new Date().getFullYear()} ProTrackR. Production High Performance Protocol Tracking.
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    const info = await mailTransporter.sendMail({
      from: sender,
      to: toEmail,
      subject: `ProTrackR Verification Code: ${otp}`,
      text: `Your ProTrackR verification code is: ${otp}. It will expire in 10 minutes.`,
      html: htmlContent
    });

    console.log(`✓ OTP sent via email to ${toEmail} (MessageId: ${info.messageId})`);
    return { success: true, devMode: false, messageId: info.messageId };
  } catch (error) {
    console.error('✗ Failed to send email via SMTP:', error.message);
    if (process.env.NODE_ENV === 'production') {
      return {
        success: false,
        error: 'Failed to deliver verification email. Please check your email address or try again later.'
      };
    }
    // Local development only: log to console
    console.log(`[PROTRACKR LOCAL DEV ONLY] OTP for ${toEmail} is: ${otp}`);
    return {
      success: true,
      devMode: true,
      error: error.message,
      message: 'SMTP delivery failed; dev OTP logged to server terminal'
    };
  }
}

module.exports = {
  sendOtpEmail
};
