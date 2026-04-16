const { Resend } = require('resend');

let resend = null;
function getResend() {
  if (!resend && process.env.RESEND_API_KEY) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

const FROM = () => process.env.FROM_EMAIL || 'WebIntel <onboarding@resend.dev>';
const APP_URL = () => process.env.APP_URL || 'https://api.webintel.dev';

async function sendMagicLinkEmail(email, token) {
  const client = getResend();
  if (!client) {
    console.warn('[email] RESEND_API_KEY not set — magic link:', token);
    return;
  }

  const link = `${APP_URL()}/api/auth/verify?token=${token}`;

  await client.emails.send({
    from: FROM(),
    to: email,
    subject: 'Sign in to WebIntel',
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:0 auto;padding:40px 24px;color:#1a1a2e">
        <h1 style="font-size:24px;margin-bottom:8px">Sign in to WebIntel</h1>
        <p style="color:#6b7280;margin-bottom:32px">Click the button below to access your dashboard. This link expires in 15 minutes.</p>
        <a href="${link}" style="display:inline-block;background:#0d9488;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">
          Sign in to Dashboard
        </a>
        <p style="font-size:12px;color:#9ca3af;margin-top:32px">
          If you didn't request this, you can safely ignore this email.<br>
          Or copy this link: <code style="word-break:break-all">${link}</code>
        </p>
      </div>
    `,
  });
}

async function sendKeyEmail(email, apiKey, tier) {
  const client = getResend();
  if (!client) {
    console.warn('[email] RESEND_API_KEY not set — skipping key email');
    return;
  }

  const tierLabel = tier === 'paid' ? 'Pro' : 'Free';
  const limits = tier === 'paid'
    ? (process.env.PAID_TIER_LIMIT || '5,000') + ' requests/day'
    : (process.env.FREE_TIER_LIMIT || '100') + ' requests/day';

  await client.emails.send({
    from: FROM(),
    to: email,
    subject: `Your WebIntel ${tierLabel} API Key`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:40px 24px;color:#1a1a2e">
        <h1 style="font-size:24px;margin-bottom:8px">Your ${tierLabel} API Key</h1>
        <p style="color:#6b7280;margin-bottom:32px">Your key is ready. Keep it secret — treat it like a password.</p>

        <div style="background:#f0fdfa;border:1px solid #99f6e4;border-radius:8px;padding:20px;margin-bottom:24px">
          <p style="font-size:12px;color:#6b7280;margin:0 0 8px;text-transform:uppercase;letter-spacing:1px">API Key</p>
          <code style="font-size:16px;font-weight:700;color:#0d9488;word-break:break-all">${apiKey}</code>
        </div>

        <table style="width:100%;font-size:14px;color:#6b7280;margin-bottom:32px">
          <tr><td style="padding:6px 0">Plan</td><td style="text-align:right;font-weight:600;color:#1a1a2e">${tierLabel}</td></tr>
          <tr><td style="padding:6px 0">Rate limit</td><td style="text-align:right;font-weight:600;color:#1a1a2e">${limits}</td></tr>
          <tr><td style="padding:6px 0">Endpoints</td><td style="text-align:right;font-weight:600;color:#1a1a2e">/v1/preview &amp; /v1/screenshot</td></tr>
        </table>

        <p style="font-size:14px;color:#6b7280;margin-bottom:16px">Quick start:</p>
        <pre style="background:#1a1a2e;color:#e4e4ef;border-radius:8px;padding:16px;font-size:13px;overflow-x:auto;line-height:1.6">curl https://api.webintel.dev/v1/preview \\
  -H "x-api-key: ${apiKey}" \\
  -G -d "url=https://github.com"</pre>

        <p style="font-size:14px;margin-top:24px">
          <a href="${APP_URL()}/dashboard.html" style="color:#0d9488;font-weight:600">View your dashboard →</a>
        </p>

        <p style="font-size:12px;color:#9ca3af;margin-top:32px">
          Questions? Reply to this email or check the <a href="${APP_URL()}" style="color:#0d9488">docs</a>.
        </p>
      </div>
    `,
  });
}

async function sendWelcomeEmail(email, apiKey) {
  return sendKeyEmail(email, apiKey, 'free');
}

module.exports = { sendMagicLinkEmail, sendKeyEmail, sendWelcomeEmail };
