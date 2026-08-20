// services/emailService.js - Email Integration & Templates
// Delivery pipeline: try Resend (HTTPS API) first; on failure — or if no Resend key — fall back
// to Zoho SMTP (Nodemailer). Every attempt's outcome is recorded in the email_log table so the
// Admin → Email Log view stays accurate. sendEmail never throws (callers may fire-and-forget).
const https = require('https');
const nodemailer = require('nodemailer');
const env = require('../config/env');
const { query } = require('../db');

const FROM_NAME = 'Fixerr';
const FROM_RESEND = 'Fixerr <noreply@getfixerr.com>';
const REPLY_TO = 'support@getfixerr.com';

// Returns a promise so callers can await the write. On serverless (Vercel) the function can be
// frozen the instant the HTTP response is sent, so the send + this log must finish *before* the
// handler responds — hence sendEmail awaits this and handlers await sendEmail.
function logEmail(recipient, subject, type, status, error) {
  const p = error
    ? query(`INSERT INTO email_log (recipient,subject,type,status,error) VALUES ($1,$2,$3,$4,$5)`,
        [recipient, subject, type, status, error])
    : query(`INSERT INTO email_log (recipient,subject,type,status) VALUES ($1,$2,$3,$4)`,
        [recipient, subject, type, status]);
  return p.catch(() => {});
}

function sendViaResend(to, subject, html) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      from: FROM_RESEND,
      reply_to: REPLY_TO,
      to: Array.isArray(to) ? to : [to],
      subject,
      html
    });
    const req = https.request({
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve();
        else reject(new Error(`Resend ${res.statusCode}: ${data}`));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

let _zohoTransport = null;
function getZohoTransport() {
  if (_zohoTransport) return _zohoTransport;
  if (!env.ZOHO_EMAIL || !env.ZOHO_PASSWORD) return null;
  _zohoTransport = nodemailer.createTransport({
    host: 'smtp.zoho.com',
    port: 465,
    secure: true,
    auth: { user: env.ZOHO_EMAIL, pass: env.ZOHO_PASSWORD }
  });
  return _zohoTransport;
}

async function sendViaZoho(to, subject, html) {
  const transport = getZohoTransport();
  if (!transport) throw new Error('Zoho SMTP not configured');
  // Zoho only permits sending from its own authenticated mailbox address.
  await transport.sendMail({
    from: `"${FROM_NAME}" <${env.ZOHO_EMAIL}>`,
    replyTo: REPLY_TO,
    to: Array.isArray(to) ? to.join(',') : to,
    subject,
    html
  });
}

async function sendEmail(to, subject, html, type = 'general') {
  const hasResend = !!env.RESEND_API_KEY;
  const hasZoho = !!(env.ZOHO_EMAIL && env.ZOHO_PASSWORD);
  if (!hasResend && !hasZoho) {
    console.log(`[EMAIL SKIP - no transport configured] To: ${to} | ${subject}`);
    await logEmail(to, subject, type, 'skipped');
    return;
  }
  let lastErr = null;
  if (hasResend) {
    try {
      await sendViaResend(to, subject, html);
      console.log(`[EMAIL SENT · resend] To: ${to} | ${subject}`);
      await logEmail(to, subject, type, 'sent');
      return;
    } catch (e) { lastErr = e; console.error('[RESEND FAIL]', e.message); }
  }
  if (hasZoho) {
    try {
      await sendViaZoho(to, subject, html);
      console.log(`[EMAIL SENT · zoho] To: ${to} | ${subject}`);
      await logEmail(to, subject, type, 'sent');
      return;
    } catch (e) { lastErr = e; console.error('[ZOHO FAIL]', e.message); }
  }
  await logEmail(to, subject, type, 'failed', lastErr ? lastErr.message : 'unknown error');
}

function wrapEmail(contentHtml) {
  return `<div style="background:#f9fafb;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
      <div style="margin-bottom:24px;text-align:left;">
        <img src="https://fixerr-app.vercel.app/fixerr-logo.png" alt="Fixerr" style="height:38px;object-fit:contain;display:block;">
      </div>
      ${contentHtml}
      <div style="margin-top:32px;padding-top:16px;border-top:1px solid #f3f4f6;text-align:left;font-size:12px;color:#9ca3af;">
        <p style="margin:0 0 4px;color:#6b7280;font-weight:600;">Fixerr On-Demand Home Services</p>
        <p style="margin:0;">Support: <a href="mailto:support@getfixerr.com" style="color:#15803d;text-decoration:none;">support@getfixerr.com</a></p>
      </div>
    </div>
  </div>`;
}

const EMAIL = {
  welcome: (name, role) => {
    const isPro = role === 'professional';
    const accountType = isPro ? 'Professional' : 'Customer';
    const benefits = isPro
      ? [
          ['📋', 'Receive job requests', 'Get matched with nearby customers who need your services.'],
          ['💰', 'Transparent earnings', 'You keep 85% of every job — Fixerr handles payments securely.'],
          ['⭐', 'Build your reputation', 'Great reviews rank you higher and win you more bookings.'],
          ['🛡️', 'Verified & protected', 'Work with confidence on a trusted, background-checked platform.']
        ]
      : [
          ['🔧', 'Trusted professionals', 'Verified, background-checked experts for 12+ home service categories.'],
          ['💳', 'Pay only after the job', 'No upfront fees — you pay securely once the work is done.'],
          ['📞', 'We confirm within 2 hours', 'Our team calls to finalize details and pricing before any work begins.'],
          ['🇮🇳🇺🇸', 'India & USA coverage', 'Local rates and support across both countries.']
        ];
    const ctaHref = isPro ? 'https://fixerr-app.vercel.app/dashboard-pro.html' : 'https://fixerr-app.vercel.app/booking.html';
    const ctaLabel = isPro ? 'Go to Your Dashboard →' : 'Book a Service →';
    const benefitRows = benefits.map(([icon, title, desc]) => `
      <tr>
        <td style="vertical-align:top;padding:8px 12px 8px 0;font-size:20px;width:32px;">${icon}</td>
        <td style="vertical-align:top;padding:8px 0;">
          <div style="font-weight:700;color:#111827;font-size:14px;">${title}</div>
          <div style="color:#6B7280;font-size:13px;line-height:1.5;">${desc}</div>
        </td>
      </tr>`).join('');
    return {
      subject: `Welcome to Fixerr, ${name}! 🎉`,
      html: wrapEmail(`
        <span style="display:inline-block;background:#d1fae5;color:#065f46;font-size:11px;font-weight:700;padding:5px 12px;border-radius:50px;text-transform:uppercase;letter-spacing:0.5px;">${accountType} Account</span>
        <h1 style="font-size:22px;color:#111827;margin:16px 0 8px;">Welcome aboard, ${name}! 👋</h1>
        <p style="color:#4b5563;font-size:15px;line-height:1.6;margin:0 0 8px;">
          Thank you for joining <strong>Fixerr</strong>. Your <strong>${accountType}</strong> account has been created successfully and is ready to use.
        </p>
        <p style="color:#4b5563;font-size:15px;line-height:1.6;margin:0 0 20px;">
          Here's what you can do with Fixerr:
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${benefitRows}</table>
        <div style="text-align:center;margin:28px 0 8px;">
          <a href="${ctaHref}" style="background:#15803d;color:#ffffff;padding:13px 28px;border-radius:50px;text-decoration:none;display:inline-block;font-weight:700;font-size:15px;">${ctaLabel}</a>
        </div>
      `)
    };
  },
  proReceived: (name) => ({
    subject: 'Application Received — Fixerr Professional',
    html: wrapEmail(`
      <h2 style="color:#15803d;margin-top:0;">Hi ${name}, we received your application!</h2>
      <p style="color:#374151;font-size:15px;">Our team will review your details and contact you within <strong>24 hours</strong>.</p>
      <p style="color:#374151;font-size:14px;"><strong>What happens next:</strong></p>
      <ol style="color:#4b5563;font-size:14px;line-height:1.6;"><li>We verify your identity and documents</li><li>Application approved or feedback given</li><li>Once approved, you start receiving bookings</li></ol>
    `)
  }),
  proApproved: (name) => ({
    subject: `🎉 You're approved — Welcome to Fixerr Professionals!`,
    html: wrapEmail(`
      <h2 style="color:#15803d;margin-top:0;">Congratulations ${name}!</h2>
      <p style="color:#374151;font-size:15px;">Your professional application has been <strong>approved</strong>. You can now log in and start receiving bookings.</p>
      <div style="text-align:center;margin:24px 0 8px;">
        <a href="https://fixerr-app.vercel.app/login.html" style="background:#15803d;color:#fff;padding:12px 24px;border-radius:50px;text-decoration:none;display:inline-block;font-weight:700;">Log In to Dashboard →</a>
      </div>
    `)
  }),
  bookingConfirmed: (name, service, date) => ({
    subject: `Booking Request Confirmed — ${service}`,
    html: wrapEmail(`
      <h2 style="color:#15803d;margin-top:0;">Thanks ${name}, we've got your request!</h2>
      <p style="color:#374151;font-size:15px;">We've received your <strong>${service}</strong> request for <strong>${date}</strong>.</p>
      <p style="color:#4b5563;font-size:14px;line-height:1.6;">Our team will call you <strong>within 2 hours</strong> to confirm the details and match you with a professional. <strong>You pay only after the job is done.</strong></p>
      <div style="text-align:center;margin:24px 0 8px;">
        <a href="https://fixerr-app.vercel.app/dashboard.html" style="background:#15803d;color:#fff;padding:12px 24px;border-radius:50px;text-decoration:none;display:inline-block;font-weight:700;">View My Bookings →</a>
      </div>
    `)
  }),
  bookingAcceptedByPro: (name, proName, proPhone, service, date, priceLine) => ({
    subject: `Your ${service} is confirmed${proName ? ' — ' + proName : ''}`,
    html: wrapEmail(`
      <h2 style="color:#15803d;margin-top:0;">Good news, ${name} — your professional is confirmed! ✅</h2>
      <p style="color:#374151;font-size:15px;">A verified professional has accepted your <strong>${service}</strong> booking${date ? ` for <strong>${date}</strong>` : ''}.</p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:20px 0;">
        <p style="margin:4px 0;color:#166534;"><strong>Professional:</strong> ${proName || 'Assigned by Fixerr'}</p>
        ${proPhone ? `<p style="margin:4px 0;color:#166534;"><strong>Contact:</strong> ${proPhone}</p>` : ''}
        <p style="margin:4px 0;color:#166534;"><strong>Service:</strong> ${service}</p>
        ${priceLine ? `<p style="margin:4px 0;color:#166534;"><strong>Agreed starting price:</strong> ${priceLine}</p>` : ''}
      </div>
      <p style="color:#4b5563;font-size:14px;line-height:1.6;">Your professional may call you to discuss the job and finalize the price before any work begins. <strong>You pay Fixerr only after the job is completed.</strong></p>
      <div style="text-align:center;margin:24px 0 8px;">
        <a href="https://fixerr-app.vercel.app/dashboard.html" style="background:#15803d;color:#fff;padding:12px 24px;border-radius:50px;text-decoration:none;display:inline-block;font-weight:700;">View Booking →</a>
      </div>
    `)
  }),
  passwordReset: (name, resetLink) => ({
    subject: 'Reset your Fixerr password',
    html: wrapEmail(`
      <h2 style="color:#15803d;margin-top:0;">Reset your password</h2>
      <p style="color:#374151;font-size:15px;">Hi ${name || 'there'},</p>
      <p style="color:#374151;font-size:15px;">We received a request to reset the password for your Fixerr account. Click the button below to choose a new password.</p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${resetLink}" style="background:#15803d;color:#fff;padding:12px 26px;border-radius:50px;text-decoration:none;display:inline-block;font-weight:700;">Reset Password →</a>
      </div>
      <p style="color:#6b7280;font-size:13px;">This link expires in <strong>45 minutes</strong> and can be used once. If you didn't request a reset, you can safely ignore this email — your password won't change.</p>
      <p style="color:#9ca3af;font-size:12px;word-break:break-all;">If the button doesn't work, paste this link into your browser:<br>${resetLink}</p>
    `)
  }),
  invoiceEmail: (name, invoiceNum, total, currency, pdfHtml) => ({
    subject: `Invoice #${invoiceNum} for your Fixerr Service`,
    html: wrapEmail(`
      <h2 style="color:#15803d;margin-top:0;">Payment Received — Thank You!</h2>
      <p style="color:#374151;font-size:15px;">Dear ${name},</p>
      <p style="color:#374151;font-size:15px;">Thank you for choosing Fixerr. Here is your official service invoice <strong>#${invoiceNum}</strong>.</p>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;padding:16px;border-radius:8px;margin:20px 0;">
        <p style="margin:4px 0;"><strong>Invoice No:</strong> ${invoiceNum}</p>
        <p style="margin:4px 0;"><strong>Total Paid:</strong> ${currency === 'INR' ? '₹' : '$'}${total}</p>
        <p style="margin:4px 0;"><strong>Status:</strong> <span style="color:#15803d;font-weight:bold;">PAID</span></p>
      </div>
      <p style="color:#4b5563;font-size:14px;">You can view and download your full invoice anytime from your Fixerr dashboard.</p>
      <div style="text-align:center;margin:24px 0 8px;">
        <a href="https://fixerr-app.vercel.app/dashboard.html" style="background:#15803d;color:#fff;padding:12px 24px;border-radius:50px;text-decoration:none;display:inline-block;font-weight:700;">View Dashboard →</a>
      </div>
    `)

      }),
  contactUs: (data) => ({
    subject: `📩 Contact Form: ${data.subject} — ${data.name}`,
    html: wrapEmail(`
      <h2 style="color:#15803d;margin-top:0;">New Contact Us Submission</h2>
      <p style="color:#374151;font-size:15px;margin:0 0 16px;">Someone submitted the Contact Us form on getfixerr.com.</p>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;padding:16px;border-radius:8px;margin:0 0 20px;">
        <p style="margin:4px 0;color:#111827;"><strong>Name:</strong> ${data.name}</p>
        <p style="margin:4px 0;color:#111827;"><strong>Email:</strong> <a href="mailto:${data.email}" style="color:#15803d;">${data.email}</a></p>
        ${data.phone ? `<p style="margin:4px 0;color:#111827;"><strong>Phone:</strong> ${data.phone}</p>` : ''}
        <p style="margin:4px 0;color:#111827;"><strong>Subject:</strong> ${data.subject}</p>
      </div>
      <p style="margin:0 0 6px;color:#111827;font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Message</p>
      <p style="color:#374151;font-size:15px;line-height:1.6;white-space:pre-wrap;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;margin:0;">${data.message}</p>
      <div style="text-align:center;margin:28px 0 8px;">
        <a href="mailto:${data.email}" style="background:#15803d;color:#ffffff;padding:12px 26px;border-radius:50px;text-decoration:none;display:inline-block;font-weight:700;">Reply to ${data.name} →</a>
      </div>
    `)


  })
};

module.exports = { sendEmail, EMAIL };
