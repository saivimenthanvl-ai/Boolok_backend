const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');

const User = require('../models/User');
const Otp = require('../models/Otp');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

const nodemailer = require('nodemailer');

// In-memory OTP storage with timestamp expiry (5 minutes)
const otpStore = new Map();

function generateOtp() {
  return crypto.randomInt(0, 1000000).toString().padStart(6, '0');
}

async function storeOtp(target, otp, type = 'register') {
  const norm = String(target).trim().toLowerCase();
  otpStore.set(norm, {
    otp: String(otp).trim(),
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
  });

  try {
    await Otp.deleteMany({ target: norm });
    await Otp.create({ target: norm, otp: String(otp).trim(), type });
  } catch (err) {
    console.warn('[otp] MongoDB Otp storage fallback to memory:', err.message);
  }
}

async function verifyOtpHelper(target, inputOtp) {
  const norm = String(target).trim().toLowerCase();
  const code = String(inputOtp).trim();

  // 1. Check memory store
  const entry = otpStore.get(norm);
  if (entry && Date.now() <= entry.expiresAt && entry.otp === code) {
    otpStore.delete(norm);
    try { await Otp.deleteMany({ target: norm }); } catch (_) {}
    return true;
  }

  // 2. Check MongoDB collection
  try {
    const dbEntry = await Otp.findOne({ target: norm, otp: code });
    if (dbEntry) {
      await Otp.deleteMany({ target: norm });
      otpStore.delete(norm);
      return true;
    }
  } catch (err) {
    console.warn('[otp] MongoDB Otp verification fallback:', err.message);
  }

  return false;
}

async function sendPhoneOtp(phoneNumber, otp) {
  const fast2smsKey = (process.env.FAST2SMS_API_KEY || '').trim();
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioAuth = process.env.TWILIO_AUTH_TOKEN;
  const twilioPhone = process.env.TWILIO_PHONE_NUMBER;

  if (fast2smsKey) {
    try {
      const cleanPhone = phoneNumber.replace(/[^0-9]/g, '').slice(-10);

      // Method 1: Fast2SMS POST with authorization header (Official API format)
      try {
        const postRes = await fetch('https://www.fast2sms.com/dev/bulkV2', {
          method: 'POST',
          headers: {
            'authorization': fast2smsKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            route: 'q',
            message: `Your Boolok AI verification code is ${otp}. Valid for 5 minutes.`,
            language: 'english',
            flash: 0,
            numbers: cleanPhone,
          }),
        });
        const postData = await postRes.json();
        console.log('[sms] Fast2SMS POST (route=q) response:', postData);

        if (postData && (postData.return === true || postData.status_code === 200)) {
          return { success: true };
        }
      } catch (postErr) {
        console.warn('[sms] Fast2SMS POST error:', postErr.message);
      }

      // Method 2: Fast2SMS GET fallback with authorization header
      const quickUrl = `https://www.fast2sms.com/dev/bulkV2?authorization=${encodeURIComponent(fast2smsKey)}&route=q&message=${encodeURIComponent(`Your Boolok AI verification code is ${otp}. Valid for 5 minutes.`)}&language=english&flash=0&numbers=${cleanPhone}`;
      const getRes = await fetch(quickUrl, {
        method: 'GET',
        headers: {
          'authorization': fast2smsKey,
        },
      });
      const getData = await getRes.json();
      console.log('[sms] Fast2SMS GET response:', getData);

      if (getData && (getData.return === true || getData.status_code === 200)) {
        return { success: true };
      }

      const errMsg = Array.isArray(getData?.message) ? getData.message.join(', ') : (getData?.message || 'Fast2SMS dispatch failed');
      return { success: false, reason: errMsg };
    } catch (e) {
      console.error('[sms] Fast2SMS network error:', e.message);
      return { success: false, reason: e.message };
    }
  }

  if (twilioSid && twilioAuth && twilioPhone) {
    try {
      const twilio = require('twilio');
      const client = twilio(twilioSid, twilioAuth);
      const formattedTo = phoneNumber.startsWith('+') ? phoneNumber : `+91${phoneNumber.replace(/[^0-9]/g, '').slice(-10)}`;
      const message = await client.messages.create({
        body: `Your Boolok AI verification code is ${otp}. Valid for 5 minutes.`,
        from: twilioPhone,
        to: formattedTo,
      });
      console.log('[sms] Twilio message sent:', message.sid);
      return { success: true };
    } catch (e) {
      console.error('[sms] Twilio error:', e.message);
      return { success: false, reason: e.message };
    }
  }

  console.error(`[sms] No working SMS provider configured for ${phoneNumber}.`);
  return { success: false, reason: 'No working SMS gateway configured. Please check FAST2SMS_API_KEY in .env.' };
}

async function sendOtpEmail(toEmail, otp, purpose = 'Account Access') {
  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = (process.env.EMAIL_FROM || process.env.RESEND_FROM || 'Boolok AI <onboarding@resend.dev>').trim();

  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #060b13; color: #ffffff; padding: 24px; margin: 0;">
      <div style="background-color: #0c1626; border: 1px solid #1a273c; border-radius: 12px; max-width: 480px; margin: 0 auto; padding: 32px; text-align: center;">
        <div style="font-size: 22px; font-weight: 800; color: #daa520; letter-spacing: 2px; margin-bottom: 6px;">★ BOOLOK AI</div>
        <div style="font-size: 13px; color: #94a3b8; margin-bottom: 24px;">AI Agent For Real Estate Services</div>
        <p style="font-size: 15px; color: #cbd5e1; line-height: 1.5; margin-bottom: 20px;">Use the following 6-digit verification code to complete your <strong>${purpose}</strong>:</p>
        <div style="background: #060b13; border: 1px solid #e6b800; border-radius: 8px; padding: 18px 24px; font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #daa520; display: inline-block; margin-bottom: 24px;">
          ${otp}
        </div>
        <p style="font-size: 13px; color: #94a3b8; line-height: 1.5;">This verification code is valid for <strong>5 minutes</strong>. If you did not request this code, please ignore this email.</p>
        <div style="font-size: 11px; color: #64748b; margin-top: 30px; border-top: 1px solid #1a273c; padding-top: 16px;">
          © 2026 Boolok GPT Real Estate Intelligence. All rights reserved.
        </div>
      </div>
    </body>
    </html>
  `;

  // ── PRIMARY: Resend API (works from Render / cloud hosting) ──────────────
  if (resendApiKey) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [toEmail],
          subject: 'Your Boolok AI Verification Code',
          text: `Your Boolok AI verification code is: ${otp}. This code expires in 5 minutes.`,
          html: htmlBody,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        console.log(`[resend] OTP email sent to ${toEmail}: ${data.id}`);
        return true;
      } else {
        console.error('[resend] Failed to send email:', JSON.stringify(data));
      }
    } catch (err) {
      console.error('[resend] Error sending email:', err.message);
    }
  }

  // ── FALLBACK: Gmail SMTP ─────────────────────────────────────────
  const gmailUser = (process.env.GMAIL_USER || '').trim();
  const rawPass = (process.env.GMAIL_APP_PASSWORD || process.env.EMAIL_PASS || '').trim();
  const pass = rawPass.replace(/\s+/g, '');

  if (!gmailUser || !pass) {
    console.warn('[email] Neither RESEND_API_KEY nor GMAIL credentials are configured. OTP email not sent.');
    return false;
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: gmailUser, pass },
      tls: {
        rejectUnauthorized: false,
      },
    });

    const info = await transporter.sendMail({
      from: `"Boolok AI" <${gmailUser}>`,
      to: toEmail,
      subject: 'Your Boolok AI Verification Code',
      text: `Your Boolok AI verification code is: ${otp}. This code expires in 5 minutes.`,
      html: htmlBody,
    });

    console.log(`[nodemailer] OTP email sent successfully to ${toEmail}: ${info.messageId}`);
    return true;
  } catch (err) {
    console.error('[nodemailer] Gmail SMTP (service=gmail) error:', err.message, 'Trying port 587 fallback...');
    try {
      const fallbackTransporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: { user: gmailUser, pass },
        tls: { rejectUnauthorized: false },
      });
      const info = await fallbackTransporter.sendMail({
        from: `"Boolok AI" <${gmailUser}>`,
        to: toEmail,
        subject: `Your Boolok AI Verification Code: ${otp}`,
        text: `Your Boolok AI verification code is: ${otp}. This code expires in 5 minutes.`,
        html: htmlBody,
      });
      console.log(`[nodemailer-fallback] OTP email sent to ${toEmail}: ${info.messageId}`);
      return true;
    } catch (fallbackErr) {
      console.error('[nodemailer-fallback] Gmail SMTP error on port 587:', fallbackErr.message);
      return false;
    }
  }
}

if (!process.env.GOOGLE_CLIENT_ID) {
  console.warn(
    '[auth] GOOGLE_CLIENT_ID is not set in backend .env. Google sign-in will not verify tokens.'
  );
}

const ALLOWED_GOOGLE_AUDIENCES = [
  process.env.GOOGLE_CLIENT_ID,
  '166853460121-jdlugm3ncga9qu4vk3b45lda5onusup2.apps.googleusercontent.com',
  '166853460121-ue9d43578k6i5211b46bfsoefo81f6di.apps.googleusercontent.com',
].filter(Boolean);

const googleClient = new OAuth2Client();

const TOKEN_ISSUER = 'boolok-gpt-api';
const TOKEN_AUDIENCE = 'boolok-gpt-client';

function createToken(user) {
  const secret = process.env.JWT_SECRET || 'boolok_default_jwt_secret_key_2026';

  return jwt.sign(
    {
      userId: user._id.toString(),
      id: user._id.toString(),
      email: user.email,
    },
    secret,
    {
      expiresIn: '7d',
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
    }
  );
}

function sanitizeUser(user) {
  return {
    id: user._id.toString(),
    _id: user._id.toString(),
    fullName: user.fullName,
    username: user.username || user.fullName?.replace(/\s+/g, '').toLowerCase() || 'user',
    email: user.email,
    phoneNumber: user.phoneNumber || null,
    isPhoneVerified: Boolean(user.isPhoneVerified),
    isEmailVerified: Boolean(user.isEmailVerified),
    profilePicture: user.profilePicture || null,
    bio: user.bio || '',
    goal: user.goal || null,
    avatarInitial: user.avatarInitial || null,
    avatarBgColor: user.avatarBgColor || null,
    avatarMode: user.avatarMode || null,
    isPro: Boolean(user.isPro || (user.subscription && user.subscription.plan === 'pro')),
    subscription: user.subscription || null,
  };
}

// POST /api/auth/send-otp (for user email registration verification)
router.post('/send-otp', async (req, res) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';

    if (!email) {
      return res.status(400).json({ message: 'Email address is required.' });
    }

    const otp = generateOtp();
    await storeOtp(email, otp, 'email');

    console.log(`[auth] Email registration OTP requested for ${email.slice(0, 3)}***`);

    // Send real email via Gmail SMTP / Resend
    const emailSent = await sendOtpEmail(email, otp, 'Account Registration');

    if (!emailSent) {
      return res.status(500).json({
        message: 'Could not send verification email. Please check your email address or try again.',
      });
    }

    return res.status(200).json({
      message: `A 6-digit verification code has been sent to ${email}.`,
      success: true,
    });
  } catch (error) {
    console.error('Send OTP error:', error);
    return res.status(500).json({ message: 'Failed to send verification email.', error: error.message });
  }
});

// POST /api/auth/verify-email-otp
router.post('/verify-email-otp', async (req, res) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const otp = typeof req.body.otp === 'string' ? req.body.otp.trim() : '';

    if (!email || !otp) {
      return res.status(400).json({ message: 'Email and OTP verification code are required.' });
    }

    const isValid = await verifyOtpHelper(email, otp);
    if (!isValid) {
      return res.status(400).json({ message: 'Invalid or expired email verification code.' });
    }

    return res.status(200).json({ success: true, verified: true, message: 'Email verified successfully.' });
  } catch (error) {
    console.error('Verify email OTP error:', error);
    return res.status(500).json({ message: 'Email verification failed.', error: error.message });
  }
});

// POST /api/auth/send-phone-otp (for mobile number verification)
router.post('/send-phone-otp', async (req, res) => {
  try {
    const rawPhone = req.body.phone || req.body.phoneNumber || '';
    const phone = typeof rawPhone === 'string' ? rawPhone.trim() : '';

    if (!phone || phone.replace(/[^0-9]/g, '').length < 8) {
      return res.status(400).json({ message: 'A valid mobile phone number is required.' });
    }

    const otp = generateOtp();
    await storeOtp(phone, otp, 'phone');

    console.log(`[auth] Mobile verification OTP requested for phone ***${phone.slice(-4)}`);

    const phoneResult = await sendPhoneOtp(phone, otp);

    if (!phoneResult.success) {
      return res.status(500).json({
        message: phoneResult.reason || 'Could not dispatch SMS to this mobile number. Please check Fast2SMS balance or gateway.',
      });
    }

    return res.status(200).json({
      success: true,
      message: `A 6-digit SMS verification code has been sent to ${phone}.`,
    });
  } catch (error) {
    console.error('Send Phone OTP error:', error);
    return res.status(500).json({ message: 'Failed to send phone OTP.', error: error.message });
  }
});

// POST /api/auth/verify-phone-otp
router.post('/verify-phone-otp', async (req, res) => {
  try {
    const rawPhone = req.body.phone || req.body.phoneNumber || '';
    const phone = typeof rawPhone === 'string' ? rawPhone.trim() : '';
    const otp = typeof req.body.otp === 'string' ? req.body.otp.trim() : '';

    if (!phone || !otp) {
      return res.status(400).json({ message: 'Phone number and verification code are required.' });
    }

    const isValid = await verifyOtpHelper(phone, otp);
    if (!isValid) {
      return res.status(400).json({ message: 'Invalid or expired mobile verification code.' });
    }

    return res.status(200).json({ success: true, verified: true, message: 'Mobile number verified successfully.' });
  } catch (error) {
    console.error('Verify phone OTP error:', error);
    return res.status(500).json({ message: 'Phone verification failed.', error: error.message });
  }
});

// POST /api/auth/send-login-otp (for passwordless OTP login)
router.post('/send-login-otp', async (req, res) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';

    if (!email) {
      return res.status(400).json({ message: 'Email address is required.' });
    }

    const otp = generateOtp();
    await storeOtp(email, otp, 'login');

    console.log(`[auth] Login OTP requested for ${email.slice(0, 3)}***`);

    // Send real email via Gmail SMTP
    const emailSent = await sendOtpEmail(email, otp, 'Account Sign-In');

    if (!emailSent && !process.env.GMAIL_APP_PASSWORD) {
      console.warn(`[auth] Note: GMAIL_APP_PASSWORD is missing in backend/.env.`);
    }

    return res.status(200).json({
      message: `A 6-digit sign-in code has been sent to ${email}.`,
      success: true,
    });
  } catch (error) {
    console.error('Send login OTP error:', error);
    return res.status(500).json({ message: 'Failed to send login code email.', error: error.message });
  }
});

// POST /api/auth/verify-login-otp
router.post('/verify-login-otp', async (req, res) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const otp = typeof req.body.otp === 'string' ? req.body.otp.trim() : '';

    if (!email || !otp) {
      return res.status(400).json({ message: 'Email and OTP code are required.' });
    }

    const isValid = verifyOtpHelper(email, otp);
    if (!isValid) {
      return res.status(400).json({ message: 'Invalid or expired OTP code.' });
    }

    let user = await User.findOne({ email });

    if (!user) {
      const defaultName = email.split('@')[0];
      const randomPassword = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);

      user = await User.create({
        fullName: defaultName.charAt(0).toUpperCase() + defaultName.slice(1),
        username: defaultName.toLowerCase(),
        email,
        password: randomPassword,
        authProvider: 'local',
        profilePicture: null,
      });
    }

    const token = createToken(user);
    return res.status(200).json({ token, user: sanitizeUser(user) });
  } catch (error) {
    console.error('Verify login OTP error:', error);
    return res.status(500).json({ message: 'Login verification failed.', error: error.message });
  }
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const fullName = typeof req.body.fullName === 'string' ? req.body.fullName.trim() : '';
    const rawUsername = typeof req.body.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const rawPhone = req.body.phoneNumber || req.body.phone || '';
    const phoneNumber = typeof rawPhone === 'string' ? rawPhone.trim() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const emailOtp = typeof req.body.emailOtp === 'string' ? req.body.emailOtp.trim() : (typeof req.body.otp === 'string' ? req.body.otp.trim() : '');
    const phoneOtp = typeof req.body.phoneOtp === 'string' ? req.body.phoneOtp.trim() : '';

    if (!fullName || !email || !password) {
      return res.status(400).json({ message: 'Full name, email and password are required.' });
    }

    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must contain at least 8 characters.' });
    }

    // Verify Email OTP (only if not already verified via verify-email-otp)
    let isEmailVerified = Boolean(req.body.isEmailVerified);
    if (!isEmailVerified && emailOtp) {
      const isEmailOtpValid = await verifyOtpHelper(email, emailOtp);
      if (!isEmailOtpValid) {
        return res.status(400).json({ message: 'Invalid or expired email verification code.' });
      }
      isEmailVerified = true;
    }

    // Mobile Phone OTP verification (Optional / ready to activate when SMS API key is configured)
    let isPhoneVerified = Boolean(req.body.isPhoneVerified);
    if (phoneNumber && phoneOtp) {
      const isPhoneOtpValid = await verifyOtpHelper(phoneNumber, phoneOtp);
      if (isPhoneOtpValid) {
        isPhoneVerified = true;
      }
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ message: 'An account already exists with this email.' });
    }

    if (phoneNumber) {
      const existingPhone = await User.findOne({ phoneNumber });
      if (existingPhone) {
        return res.status(409).json({ message: 'An account already exists with this mobile number.' });
      }
    }

    const username = rawUsername || fullName.replace(/\s+/g, '').toLowerCase();

    // Check if username is already taken by another user
    const existingUsername = await User.findOne({ username });
    const finalUsername = existingUsername ? `${username}${Math.floor(100 + Math.random() * 900)}` : username;

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await User.create({
      fullName,
      username: finalUsername,
      email,
      phoneNumber: phoneNumber || null,
      isEmailVerified,
      isPhoneVerified,
      password: passwordHash,
      authProvider: 'local',
      profilePicture: null,
    });

    const token = createToken(user);
    return res.status(201).json({ token, user: sanitizeUser(user) });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ message: 'Registration failed.', error: error.message });
  }
});

// POST /api/auth/login (supports email OR username)
router.post('/login', async (req, res) => {
  try {
    const rawIdentifier = req.body.username || req.body.email || req.body.identifier || '';
    const identifier = typeof rawIdentifier === 'string' ? rawIdentifier.trim().toLowerCase() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (!identifier || !password) {
      return res.status(400).json({ message: 'Username/email and password are required.' });
    }

    // Search by either email OR username
    const user = await User.findOne({
      $or: [{ email: identifier }, { username: identifier }],
    }).select('+password');

    if (!user) {
      return res.status(401).json({ message: 'Incorrect username/email or password.' });
    }

    if (!user.password || user.requiresPasswordReset) {
      return res.status(401).json({
        message:
          user.authProvider === 'google'
            ? 'This account uses Google sign-in. Please continue with Google.'
            : (user.requiresPasswordReset
                ? 'Password reset is required for security. Please use Forgot Password to set a new password.'
                : 'Incorrect username/email or password.'),
      });
    }

    const passwordMatches = await bcrypt.compare(password, user.password);

    if (!passwordMatches) {
      return res.status(401).json({ message: 'Incorrect username/email or password.' });
    }

    const token = createToken(user);
    return res.status(200).json({ token, user: sanitizeUser(user) });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ message: 'Login failed.', error: error.message });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!email) {
      return res.status(400).json({ message: 'Email address is required.' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'No registered account found with this email address.' });
    }

    const otp = generateOtp();
    await storeOtp(email, otp, 'password_reset');
    console.log(`[auth] Password reset OTP requested for ${email.slice(0, 3)}***`);

    const emailSent = await sendOtpEmail(email, otp, 'Password Reset');
    if (!emailSent && !process.env.GMAIL_APP_PASSWORD) {
      console.warn(`[auth] Note: GMAIL_APP_PASSWORD is not configured in backend/.env.`);
    }

    return res.status(200).json({
      message: `A 6-digit password reset code has been sent to ${email}.`,
      success: true,
      email,
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({ message: 'Failed to process password reset request.', error: error.message });
  }
});

// POST /api/auth/verify-reset-otp
router.post('/verify-reset-otp', async (req, res) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const otp = typeof req.body.otp === 'string' ? req.body.otp.trim() : '';

    if (!email || !otp) {
      return res.status(400).json({ message: 'Email and verification code are required.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const entry = otpStore.get(normalizedEmail);

    if (!entry) {
      return res.status(400).json({ message: 'No reset request found for this email, or the code expired.' });
    }

    if (Date.now() > entry.expiresAt) {
      otpStore.delete(normalizedEmail);
      return res.status(400).json({ message: 'Verification code has expired. Please request a new one.' });
    }

    if (entry.otp !== otp) {
      return res.status(400).json({ message: 'Incorrect 6-digit code. Please check and try again.' });
    }

    return res.status(200).json({
      message: 'Code verified successfully.',
      success: true,
    });
  } catch (error) {
    console.error('Verify reset OTP error:', error);
    return res.status(500).json({ message: 'Failed to verify code.', error: error.message });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const otp = typeof req.body.otp === 'string' ? req.body.otp.trim() : '';
    const newPassword = typeof req.body.newPassword === 'string' ? req.body.newPassword : '';

    if (!email || !otp) {
      return res.status(400).json({ message: 'Email and 6-digit verification code are required.' });
    }

    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ message: 'New password must contain at least 8 characters.' });
    }

    const isValidOtp = await verifyOtpHelper(email, otp);
    if (!isValidOtp) {
      return res.status(400).json({ message: 'Invalid or expired verification code. Please request a new code.' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'No registered account found with this email.' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    user.password = hashedPassword;
    await user.save();

    console.log(`[auth] Password successfully reset for ${email}`);

    return res.status(200).json({
      message: 'Your password has been reset successfully! You can now log in.',
      success: true,
    });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ message: 'Failed to reset password.', error: error.message });
  }
});

// POST /api/auth/google
router.post('/google', async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ message: 'Google ID token is required.' });
    }

    let email;
    let fullName = 'Google User';
    let profilePicture = null;
    let googleSubject = null;
    let isEmailVerified = false;

    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: ALLOWED_GOOGLE_AUDIENCES.length > 0 ? ALLOWED_GOOGLE_AUDIENCES : undefined,
      });
      const payload = ticket.getPayload();
      if (!payload) {
        throw new Error('Google identity payload could not be verified.');
      }
      email = payload.email?.toLowerCase();
      fullName = payload.name || payload.given_name || 'Google User';
      profilePicture = payload.picture || null;
      googleSubject = payload.sub || null;
      isEmailVerified = Boolean(payload.email_verified);
    } catch (verifyErr) {
      console.warn('[auth] Google token cryptographic verification failed:', verifyErr.message);
      // If client IDs are configured, reject unverified tokens for security
      if (ALLOWED_GOOGLE_AUDIENCES.length > 0) {
        return res.status(401).json({ message: 'Invalid Google identity token.', error: verifyErr.message });
      }
      // Development fallback only if no audiences are configured
      const decoded = jwt.decode(idToken);
      if (decoded && decoded.email) {
        email = decoded.email.toLowerCase();
        fullName = decoded.name || 'Google User';
        profilePicture = decoded.picture || null;
        googleSubject = decoded.sub || null;
        isEmailVerified = Boolean(decoded.email_verified);
      } else {
        throw verifyErr;
      }
    }

    if (!email) {
      return res.status(400).json({ message: 'Google account has no verified email address.' });
    }

    // 1. Look up user by Google Subject first (stable identifier)
    let user = googleSubject ? await User.findOne({ googleSubject }) : null;

    // 2. If not found by googleSubject, look up by email
    if (!user) {
      user = await User.findOne({ email });
    }

    if (!user) {
      const randomPassword = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
      let baseUsername = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '');
      if (!baseUsername) baseUsername = 'user';
      let uniqueUsername = baseUsername;
      let counter = 1;

      // Ensure username uniqueness
      while (await User.findOne({ username: uniqueUsername })) {
        uniqueUsername = `${baseUsername}${counter}`;
        counter++;
      }

      user = await User.create({
        fullName,
        username: uniqueUsername,
        email,
        password: randomPassword,
        authProvider: 'google',
        googleSubject,
        profilePicture,
        isEmailVerified: isEmailVerified,
      });
    } else {
      // Existing user: preserve account, update Google linking and details cleanly
      if (googleSubject && !user.googleSubject) {
        user.googleSubject = googleSubject;
      }
      if (profilePicture && !user.profilePicture) {
        user.profilePicture = profilePicture;
      }
      if (isEmailVerified && !user.isEmailVerified) {
        user.isEmailVerified = true;
      }
      if (user.authProvider !== 'google') {
        user.authProvider = 'google';
      }
      await user.save();
    }

    const token = createToken(user);
    return res.status(200).json({ token, user: sanitizeUser(user) });
  } catch (error) {
    console.error('Google sign-in error:', error);
    return res.status(401).json({ message: 'Google sign-in failed.', error: error.message });
  }
});

// PUT /api/auth/personalize
router.put('/personalize', authMiddleware, async (req, res) => {
  try {
    const allowedGoals = ['buying', 'selling', 'investing', 'analysis'];
    const { goal, profilePicture } = req.body;

    if (goal && !allowedGoals.includes(goal)) {
      return res.status(400).json({ message: 'Invalid personalization goal.' });
    }

    const userId = req.user?.id || req.user?._id || req.userId;
    const updateObj = {};
    if (goal) updateObj.goal = goal;
    if (profilePicture !== undefined) updateObj.profilePicture = profilePicture ? profilePicture.trim() : null;

    const user = await User.findByIdAndUpdate(userId, { $set: updateObj }, { new: true });

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    return res.status(200).json({ user: sanitizeUser(user) });
  } catch (error) {
    console.error('Personalization error:', error);
    return res.status(500).json({ message: 'Failed to save personalization.', error: error.message });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id || req.userId;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }
    return res.status(200).json({ user: sanitizeUser(user) });
  } catch (error) {
    console.error('Fetch me error:', error);
    return res.status(500).json({ message: 'Failed to fetch current user.', error: error.message });
  }
});

// PUT /api/auth/profile
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id || req.userId;
    const { username, fullName, profilePicture, bio } = req.body;

    const updateData = {};
    if (typeof fullName === 'string' && fullName.trim()) updateData.fullName = fullName.trim();
    if (typeof username === 'string') updateData.username = username.trim().toLowerCase();
    if (typeof profilePicture === 'string') updateData.profilePicture = profilePicture;
    if (typeof bio === 'string') updateData.bio = bio;

    const user = await User.findByIdAndUpdate(userId, updateData, { new: true });

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    return res.status(200).json({ user: sanitizeUser(user) });
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({ message: 'Failed to update profile.', error: error.message });
  }
});

module.exports = router;