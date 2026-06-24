const nodemailer = require("nodemailer");

let transporter;

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const getTransporter = () => {
  if (transporter) return transporter;

  const port = Number.parseInt(process.env.SMTP_PORT, 10) || 587;
  const secure =
    process.env.SMTP_SECURE === undefined
      ? port === 465
      : process.env.SMTP_SECURE.toLowerCase() === "true";

  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error(
      "Email configuration is incomplete. Set SMTP_HOST, SMTP_USER, and SMTP_PASS.",
    );
  }

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  return transporter;
};

const logoUrl =
  process.env.EMAIL_LOGO_URL ||
  `${process.env.APP_URL || "https://app.paytraka.ng"}/paytraka_logo/paytraka-logo-navbar.png`;

const supportEmail =
  process.env.SUPPORT_EMAIL || "support@paytraka.ng";

const getFromAddress = () => {
  const smtpUser = process.env.SMTP_USER.trim();
  const configuredFrom = process.env.SMTP_FROM?.trim();
  const allowCustomFrom =
    process.env.SMTP_ALLOW_CUSTOM_FROM?.toLowerCase() === "true";

  if (configuredFrom) {
    const configuredAddress =
      configuredFrom.match(/<([^<>]+)>/)?.[1]?.trim() || configuredFrom;

    if (
      configuredAddress.toLowerCase() === smtpUser.toLowerCase() ||
      allowCustomFrom
    ) {
      return configuredFrom;
    }
  }

  return {
    name: process.env.SMTP_FROM_NAME || "PayTraka",
    address: smtpUser,
  };
};

const emailStyles = `
  body {
    margin: 0;
    padding: 0;
    background: #F4F6FA;
    color: #191C1E;
    font-family: Arial, Helvetica, sans-serif;
  }

  table {
    border-spacing: 0;
    border-collapse: collapse;
  }

  img {
    border: 0;
    display: block;
  }

  .page {
    width: 100%;
    background: #F4F6FA;
    padding: 40px 16px;
  }

  .container {
    width: 100%;
    max-width: 600px;
    background: #FFFFFF;
    border: 1px solid #DCE0E8;
    border-radius: 18px;
    overflow: hidden;
    box-shadow: 0 16px 45px rgba(17, 23, 232, 0.08);
  }

  .header {
    padding: 28px 36px;
    border-bottom: 1px solid #E4E7ED;
    background: #FFFFFF;
  }

  .logo {
    width: 155px;
    max-width: 100%;
    height: auto;
  }

  .content {
    padding: 42px 36px 36px;
  }

  .eyebrow {
    margin: 0 0 14px;
    color: #1117E8;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 1.4px;
    text-transform: uppercase;
  }

  .title {
    margin: 0;
    color: #121B3A;
    font-size: 30px;
    line-height: 1.2;
    font-weight: 800;
  }

  .message {
    margin: 18px 0 0;
    color: #566074;
    font-size: 16px;
    line-height: 1.75;
  }

  .code-container {
    padding: 30px 0 12px;
    text-align: center;
  }

  .code-label {
    margin: 0 0 10px;
    color: #757588;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
  }

  .code-box {
    display: inline-block;
    margin: 0;
    padding: 18px 28px;
    background: #EEF0FF;
    border: 1px solid #C9CDFF;
    border-radius: 14px;
    color: #0001B1;
    font-size: 30px;
    line-height: 1;
    font-weight: 800;
    letter-spacing: 8px;
  }

  .notice {
    margin-top: 26px;
    padding: 16px 18px;
    background: #F7F9FB;
    border-left: 4px solid #1117E8;
    border-radius: 8px;
    color: #566074;
    font-size: 13px;
    line-height: 1.65;
  }

  .button-container {
    padding-top: 28px;
  }

  .button {
    display: inline-block;
    padding: 14px 25px;
    background: #1117E8;
    border-radius: 10px;
    color: #FFFFFF !important;
    font-size: 15px;
    font-weight: 700;
    text-decoration: none;
  }

  .features {
    margin-top: 30px;
    padding: 22px;
    background: #F7F9FB;
    border: 1px solid #E4E7ED;
    border-radius: 14px;
  }

  .feature {
    padding: 7px 0;
    color: #454557;
    font-size: 14px;
    line-height: 1.5;
  }

  .feature-mark {
    color: #1117E8;
    font-weight: 800;
  }

  .footer {
    padding: 26px 36px;
    background: #0D1230;
    color: #C9CDE0;
    font-size: 12px;
    line-height: 1.7;
    text-align: center;
  }

  .footer a {
    color: #FFFFFF;
    font-weight: 700;
    text-decoration: none;
  }

  .footer-brand {
    margin: 12px 0 0;
    color: #FFFFFF;
    font-weight: 700;
  }

  @media only screen and (max-width: 620px) {
    .page {
      padding: 18px 10px !important;
    }

    .header {
      padding: 22px 24px !important;
    }

    .content {
      padding: 32px 24px 28px !important;
    }

    .title {
      font-size: 25px !important;
    }

    .code-box {
      padding: 17px 20px !important;
      font-size: 26px !important;
      letter-spacing: 6px !important;
    }

    .footer {
      padding: 24px !important;
    }
  }
`;

const emailWrapper = ({ eyebrow, title, body }) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  />
  <title>${escapeHtml(title)}</title>
  <style>${emailStyles}</style>
</head>

<body>
  <table role="presentation" width="100%" class="page">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" class="container">
          <tr>
            <td class="header">
              <img
                src="${escapeHtml(logoUrl)}"
                alt="PayTraka"
                width="155"
                class="logo"
              />
            </td>
          </tr>

          <tr>
            <td class="content">
              <p class="eyebrow">${escapeHtml(eyebrow)}</p>
              <h1 class="title">${escapeHtml(title)}</h1>
              ${body}
            </td>
          </tr>

          <tr>
            <td class="footer">
              <p>
                Need assistance? Contact
                <a href="mailto:${escapeHtml(supportEmail)}">
                  ${escapeHtml(supportEmail)}
                </a>
              </p>

              <p class="footer-brand">
                Invoicing that works. Compliance when you’re ready.
              </p>

              <p>
                &copy; ${new Date().getFullYear()} PayTraka.
                All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

const otpEmailHtml = ({ name, otp }) =>
  emailWrapper({
    eyebrow: "Email verification",
    title: "Verify your PayTraka account",
    body: `
      <p class="message">
        Hello <strong>${escapeHtml(name)}</strong>,
      </p>

      <p class="message">
        Welcome to PayTraka. Use the verification code below to
        complete your registration and activate your business workspace.
      </p>

      <div class="code-container">
        <p class="code-label">Your verification code</p>
        <div class="code-box">${escapeHtml(otp)}</div>
      </div>

      <div class="notice">
        This code expires in <strong>24 hours</strong>.
        If you did not create a PayTraka account, you can safely ignore
        this email.
      </div>
    `,
  });

const passwordResetEmailHtml = ({ name, otp }) =>
  emailWrapper({
    eyebrow: "Account security",
    title: "Reset your password",
    body: `
      <p class="message">
        Hello <strong>${escapeHtml(name)}</strong>,
      </p>

      <p class="message">
        We received a request to reset your PayTraka password.
        Enter the security code below to continue.
      </p>

      <div class="code-container">
        <p class="code-label">Password reset code</p>
        <div class="code-box">${escapeHtml(otp)}</div>
      </div>

      <div class="notice">
        This code expires in <strong>1 hour</strong>.
        If you did not request a password reset, ignore this email.
        Your password will remain unchanged.
      </div>
    `,
  });

const welcomeEmailHtml = ({ name }) =>
  emailWrapper({
    eyebrow: "Workspace activated",
    title: "Welcome to PayTraka",
    body: `
      <p class="message">
        Hello <strong>${escapeHtml(name)}</strong>,
      </p>

      <p class="message">
        Your email has been verified and your PayTraka workspace is
        ready. You can now manage your business records from one secure
        dashboard.
      </p>

      <div class="features">
        <div class="feature">
          <span class="feature-mark">✓</span>
          Create professional sales invoices
        </div>

        <div class="feature">
          <span class="feature-mark">✓</span>
          Manage customers, suppliers and receipts
        </div>

        <div class="feature">
          <span class="feature-mark">✓</span>
          Track payments and outstanding balances
        </div>

        <div class="feature">
          <span class="feature-mark">✓</span>
          Prepare records for tax-compliance workflows
        </div>
      </div>

      <div class="button-container">
        <a
          href="${escapeHtml(process.env.APP_URL || "https://app.paytraka.ng")}"
          class="button"
        >
          Open Your Dashboard
        </a>
      </div>

      <div class="notice">
        For the best experience, complete your company profile,
        tax information and business address after signing in.
      </div>
    `,
  });

const sendEmail = ({ to, subject, text, html }) =>
  getTransporter().sendMail({
    // Most SMTP providers reject unverified From domains. Use the
    // authenticated mailbox unless a custom sender was explicitly approved.
    from: getFromAddress(),
    to,
    subject,
    text,
    html,
  });

const sendOtpEmail = ({ to, name, otp }) =>
  sendEmail({
    to,
    subject: "Verify your PayTraka account",
    text: `Hello ${name}, your PayTraka verification code is ${otp}. It expires in 24 hours.`,
    html: otpEmailHtml({ name, otp }),
  });

const sendPasswordResetEmail = ({ to, name, otp }) =>
  sendEmail({
    to,
    subject: "Reset your PayTraka password",
    text: `Hello ${name}, your PayTraka password reset code is ${otp}. It expires in 1 hour.`,
    html: passwordResetEmailHtml({ name, otp }),
  });

const sendWelcomeEmail = ({ to, name }) =>
  sendEmail({
    to,
    subject: "Welcome to PayTraka 🎉",
    text: `Hello ${name}, your PayTraka workspace is verified and ready to use.`,
    html: welcomeEmailHtml({ name }),
  });

module.exports = {
  sendOtpEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
};
