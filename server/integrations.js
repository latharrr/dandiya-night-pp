/*
 * integrations.js: the ONLY file tech needs to edit to connect Picapool.
 * Every function has a working default so the server runs end to end today.
 * Replace the bodies marked TODO with calls to Picapool's real services.
 */
'use strict';

// Dev-only behaviour (codes printed to the log) needs NODE_ENV=development or test. Unset or production = never fake a send.
const DEV = ['development', 'test'].includes(process.env.NODE_ENV);

module.exports = {
  /**
   * Send the login code to the user's WhatsApp/SMS.
   * DEFAULT: dev prints the code to the server log. Production throws until wired,
   * so nobody can log in with codes that were never delivered.
   */
  async sendOtp(phone, code) {
    // TODO tech: call Picapool's existing OTP sender (WhatsApp template or SMS).
    if (DEV) { console.log(`[otp] +91${phone} → ${code}`); return; }
    throw new Error('OTP sender not configured (integrations.sendOtp)');
  },

  /**
   * Set to true once findPicapoolUser really queries Picapool. While false, the page tells people
   * "Couldn't check Picapool right now" and carries on, instead of claiming they have no account.
   */
  lookupWired: false,

  /**
   * Look up a Picapool account by phone (10 digits, no +91).
   * Return null if none, or {picapoolId, firstName?, gender?, college?}. gender must be 'female' | 'male' if known.
   * firstName may be a full name; Stick Together keeps the first word.
   * Called after OTP, on "I've signed up", when the page comes back into view, and every few minutes while linked,
   * so keep it fast (one indexed query). What happens with the answer (name/gender clashes etc.): HANDOFF §4b.
   */
  async findPicapoolUser(phone) {
    // TODO tech: query Picapool users table by phone.
    return null;
  },

  /**
   * Create (or complete) the Picapool account for a new Dandiya signup, keyed by phone.
   * Return the Picapool user id (string). Called once per new person, when they finish "About you".
   * If you wire this, everyone gets a Picapool account automatically: the "One small step before you chat" sheet never shows,
   * and when they open the app with the same number their chats are already there. HANDOFF §4b explains both options.
   */
  async createPicapoolAccount({phone, firstName, gender, college, ref}) {
    // TODO tech: insert into Picapool users. This is the KPI: new accounts.
    return null; // null = not linked yet; the Dandiya account still works
  },

  /**
   * Create a 1:1 Picapool chat between two people and post the opener (may be null).
   * a and b are Dandiya user rows ({id, phone, first_name, picapool_id}).
   * Return a chat id string. The thread must appear in the app for b after they log in with b.phone.
   */
  async createChat(a, b, opener) {
    // TODO tech: call Picapool chat service. Until then a placeholder id is returned.
    return 'pending-' + [a.id, b.id].sort().join('-');
  },

  /**
   * Someone who matched with `to` sent them a message request, but `to` isn't on Picapool yet.
   * Tell them (WhatsApp template), e.g. "{from} sent you a message on Picapool. Download the app with this number to read it."
   * The page tells the sender "{name} is reviewing your message request", so this should really reach them.
   */
  async notifyMessageRequest(to, from) {
    // TODO tech: send approved WhatsApp template with the app download link.
    if (DEV) console.log(`[notify] +91${to.phone}: message request from ${from.first_name}`);
  },

  /**
   * Tell someone they have a new match (WhatsApp template).
   * `to` is the user row of the person to notify, `other` the person they matched with.
   */
  async notifyMatch(to, other) {
    // TODO tech: send approved WhatsApp template, e.g. "Naya Dandiya match aaya hai 💃 {link}".
    if (DEV) console.log(`[notify] +91${to.phone}: new match with ${other.first_name}`);
  },
};
