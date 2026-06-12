const nodemailer = require('nodemailer');

const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 465,
    secure: process.env.SMTP_SECURE !== 'false', // true by default
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

const emailStyles = `
  body { margin:0; padding:0; font-family:'Inter',sans-serif; background:linear-gradient(135deg,#1e3a8a,#312e81); color:#fff; }
  .container { max-width:600px; margin:40px auto; background:#0f172a; border-radius:12px; overflow:hidden; box-shadow:0 0 20px rgba(63,63,191,0.4); }
  .header { background:linear-gradient(90deg,#0ea5e9,#6366f1); text-align:center; padding:30px 20px; }
  .header h1 { margin:0; font-size:28px; letter-spacing:2px; color:#fff; font-weight:bold; }
  .content { padding:30px 20px; text-align:center; }
  .content p { font-size:16px; line-height:1.6; color:#e0e7ff; }
  .code-box { margin:20px auto; padding:15px 24px; background:#1e40af; color:#fff; font-size:28px; font-weight:bold; letter-spacing:6px; border-radius:8px; display:inline-block; }
  .footer { padding:20px; font-size:12px; color:#94a3b8; text-align:center; }
  a { color:#38bdf8; text-decoration:none; }
  a.button { display:inline-block; margin-top:20px; padding:12px 28px; background:#6366f1; color:#fff; text-decoration:none; font-weight:bold; border-radius:8px; box-shadow:0 0 15px rgba(99,102,241,0.5); }
`;

const emailWrapper = (body) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <style>${emailStyles}</style>
</head>
<body>
  <div class="container">
    <div class="header"><h1>PayTraka</h1></div>
    <div class="content">${body}</div>
    <div class="footer">
      <p>Need help? Contact us at <a href="mailto:${process.env.SUPPORT_EMAIL || 'support@paytraka.ng'}">${process.env.SUPPORT_EMAIL || 'support@paytraka.ng'}</a></p>
      <p>&copy; ${new Date().getFullYear()} PayTraka. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;

// Send OTP for registration
const sendOtpEmail = async ({ to, name, otp }) => {
  const transporter = createTransporter();
  await transporter.sendMail({
    from: `"PayTraka" <${process.env.SMTP_USER}>`,
    to,
    subject: 'Verify your PayTraka account',
    html: emailWrapper(`
      <p>Hello <strong>${name}</strong>,</p>
      <p>Welcome to <strong>PayTraka</strong>! To complete your registration, verify your email with the code below:</p>
      <div class="code-box">${otp}</div>
      <p>This code expires in <strong>24 hours</strong>. If you didn't sign up, please ignore this email.</p>
    `),
  });
};

// Send password reset OTP
const sendPasswordResetEmail = async ({ to, name, otp }) => {
  const transporter = createTransporter();
  await transporter.sendMail({
    from: `"PayTraka" <${process.env.SMTP_USER}>`,
    to,
    subject: 'Reset your PayTraka password',
    html: emailWrapper(`
      <p>Hello <strong>${name}</strong>,</p>
      <p>You requested a password reset. Use the code below:</p>
      <div class="code-box">${otp}</div>
      <p>This code expires in <strong>1 hour</strong>. If you didn't request this, you can ignore this email.</p>
    `),
  });
};

// Welcome email after OTP verified
const sendWelcomeEmail = async ({ to, name }) => {
  const transporter = createTransporter();
  await transporter.sendMail({
    from: `"PayTraka" <${process.env.SMTP_USER}>`,
    to,
    subject: 'Welcome to PayTraka 🎉',
    html: emailWrapper(`
      <p>Hello <strong>${name}</strong>,</p>
      <p>Your account has been verified and is ready to use.</p>
      <p>You can now generate FIRS-compliant invoices, track payments, and manage your business finances with ease.</p>
      <a href="${process.env.APP_URL || 'https://app.paytraka.ng'}" class="button">Go to Dashboard</a>
    `),
  });
};

module.exports = { sendOtpEmail, sendPasswordResetEmail, sendWelcomeEmail };
