/*
 * integrations.js: everything that talks to the outside world.
 * Login codes go out on WhatsApp (Meta Cloud API, an approved Authentication template) and/or SMS (MSG91, DLT-approved template).
 * New-pair alerts go out on WhatsApp. All of it is switched on by env vars (HANDOFF §3b); nothing here needs editing to launch.
 * The Picapool functions below are still stubs: they need Picapool's backend (HANDOFF §4).
 */
'use strict';

// Dev-only behaviour (codes printed to the log) needs NODE_ENV=development or test. Unset or production = never fake a send.
const DEV = ['development', 'test'].includes(process.env.NODE_ENV);
const E = process.env;

const WA = {
  token: E.WHATSAPP_TOKEN || '',                     // permanent (system user) access token with whatsapp_business_messaging
  phoneId: E.WHATSAPP_PHONE_NUMBER_ID || '',         // the Phone Number ID from WhatsApp Manager → API Setup (not the phone number)
  version: E.WHATSAPP_API_VERSION || 'v23.0',
  base: (E.WHATSAPP_API_BASE || 'https://graph.facebook.com').replace(/\/$/, ''), // only changed by the tests
  otpTemplate: E.WHATSAPP_OTP_TEMPLATE || '',        // approved Authentication template, e.g. "dandiya_login_code"
  otpLang: E.WHATSAPP_OTP_LANG || 'en',
  otpButton: E.WHATSAPP_OTP_BUTTON !== '0',          // Authentication templates with a "Copy code" button need the code on the button too
  matchTemplate: E.WHATSAPP_MATCH_TEMPLATE || '',    // approved Utility template for "you have a new pair"
  matchLang: E.WHATSAPP_MATCH_LANG || 'en',
  matchVars: (E.WHATSAPP_MATCH_VARS ?? 'name').split(',').map(s => s.trim()).filter(Boolean), // body {{1}}, {{2}}… in order: name | me | college | link
  matchButtonVar: E.WHATSAPP_MATCH_BUTTON_VAR || '', // set only if the template has a URL button with a variable: name | me | college | link
};
const SMS = {
  key: E.MSG91_AUTH_KEY || '',
  template: E.MSG91_TEMPLATE_ID || '',               // MSG91's own template id (not the DLT id), linked to the DLT template
  mode: E.MSG91_MODE === 'flow' ? 'flow' : 'otp',    // 'otp' = template made under OTP; 'flow' = template made under SMS → Templates
  flowVar: E.MSG91_OTP_VAR || 'OTP',                 // flow mode: the variable name the template uses for the code
  base: (E.MSG91_API_BASE || 'https://control.msg91.com').replace(/\/$/, ''),     // only changed by the tests
};
const APP_URL = (E.APP_URL || 'https://dandiya.picapool.tech').replace(/\/$/, '');
const waReady = () => !!(WA.token && WA.phoneId && WA.otpTemplate);
const smsReady = () => !!(SMS.key && SMS.template);
const CHANNELS = (E.OTP_CHANNELS || 'whatsapp,sms').split(',').map(s => s.trim()).filter(c => c === 'whatsapp' || c === 'sms');
const ready = c => c === 'whatsapp' ? waReady() : smsReady();

async function post(url, headers, body) {
  const res = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json', ...headers}, body: JSON.stringify(body), signal: AbortSignal.timeout(10e3)});
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
  return {ok: res.ok, status: res.status, json, text: text.slice(0, 300)};
}
/* one WhatsApp template message. `body` fills {{1}}, {{2}}…; `button` fills a URL/copy-code button's variable */
async function waTemplate(phone, name, lang, body = [], button = null) {
  const components = [];
  if (body.length) components.push({type: 'body', parameters: body.map(t => ({type: 'text', text: String(t)}))});
  if (button !== null) components.push({type: 'button', sub_type: 'url', index: '0', parameters: [{type: 'text', text: String(button)}]});
  const r = await post(`${WA.base}/${WA.version}/${WA.phoneId}/messages`, {Authorization: `Bearer ${WA.token}`},
    {messaging_product: 'whatsapp', to: '91' + phone, type: 'template', template: {name, language: {code: lang}, components}});
  if (!r.ok) throw new Error(`WhatsApp ${r.status}: ${r.json?.error?.message || r.text}`);
  return r.json;
}
async function sendSms(phone, code) {
  const headers = {authkey: SMS.key, accept: 'application/json'};
  const r = SMS.mode === 'flow'
    ? await post(`${SMS.base}/api/v5/flow`, headers, {template_id: SMS.template, short_url: '0', recipients: [{mobiles: '91' + phone, [SMS.flowVar]: code}]})
    : await post(`${SMS.base}/api/v5/otp?template_id=${encodeURIComponent(SMS.template)}&mobile=91${phone}&otp=${encodeURIComponent(code)}`, headers, {});
  if (!r.ok || (r.json && r.json.type && r.json.type !== 'success')) throw new Error(`MSG91 ${r.status}: ${r.json?.message || r.text}`);
}
const fill = (v, to, other) => ({name: other.first_name, me: to.first_name, college: other.college, link: APP_URL}[v] ?? '');

module.exports = {
  /** Which ways a login code can go out right now: ['whatsapp', 'sms'] in the order they are tried. */
  otpChannels() { return CHANNELS.filter(ready); },

  /**
   * Send the login code. `prefer` = 'sms' | 'whatsapp' (the "Send by SMS instead" button) or null for the normal order.
   * Returns the channel that took it. Tries the next channel if one fails. Throws if none worked,
   * so nobody is asked for a code that was never sent. Dev prints the code to the log instead.
   */
  async sendOtp(phone, code, prefer = null) {
    const order = this.otpChannels();
    if (!order.length) {
      if (DEV) { console.log(`[otp] +91${phone} → ${code}`); return 'whatsapp'; }
      throw new Error('No login-code sender configured (set the WHATSAPP_* or MSG91_* env vars)');
    }
    if (prefer && order.includes(prefer)) order.sort((a, b) => (b === prefer) - (a === prefer));
    let last;
    for (const c of order) {
      try {
        if (c === 'whatsapp') await waTemplate(phone, WA.otpTemplate, WA.otpLang, [code], WA.otpButton ? code : null);
        else await sendSms(phone, code);
        return c;
      } catch (e) { last = e; console.error(`[otp] ${c} failed for +91${phone.slice(0, 2)}xxxxxx${phone.slice(8)}:`, e.message); }
    }
    throw last;
  },

  /**
   * Tell someone they have a new pair (WhatsApp template). `to` is the person to tell, `other` who they paired with.
   * Off until WHATSAPP_MATCH_TEMPLATE is set. Never blocks the swipe: errors are only logged.
   */
  async notifyMatch(to, other) {
    if (WA.token && WA.phoneId && WA.matchTemplate) {
      await waTemplate(to.phone, WA.matchTemplate, WA.matchLang, WA.matchVars.map(v => fill(v, to, other)), WA.matchButtonVar ? fill(WA.matchButtonVar, to, other) : null);
      return;
    }
    if (DEV) console.log(`[notify] +91${to.phone}: new pair with ${other.first_name}`);
  },

  /* ---------------- Picapool (needs Picapool's backend; HANDOFF §4) ---------------- */

  /**
   * Set to true once findPicapoolUser really queries Picapool. While false the page skips the Picapool check
   * and nothing claims someone has or hasn't got an account.
   */
  lookupWired: false,

  /**
   * Look up a Picapool account by phone (10 digits, no +91).
   * Return null if none, or {picapoolId, firstName?, gender?, college?}. gender must be 'female' | 'male' if known.
   */
  async findPicapoolUser(phone) {
    // TODO Picapool: query the users table by phone.
    return null;
  },

  /**
   * Create (or complete) the Picapool account for a new Dandiya signup, keyed by phone. Return the Picapool user id.
   * Until this is wired, export signups from /admin (CSV) and import them.
   */
  async createPicapoolAccount({phone, firstName, gender, college, ref}) {
    // TODO Picapool: insert into Picapool users. This is the KPI: new accounts.
    return null;
  },

  /**
   * Create a 1:1 Picapool chat between two people and post the opener (may be null). Return a chat id string.
   * Only used when the page has CONFIG.CHAT_ENABLED = true (off at launch: pairs swap numbers).
   */
  async createChat(a, b, opener) {
    // TODO Picapool: call the chat service.
    return 'pending-' + [a.id, b.id].sort().join('-');
  },

  /** Someone sent `to` a chat request but `to` isn't on Picapool yet. Only reachable with chat on. */
  async notifyMessageRequest(to, from) {
    if (DEV) console.log(`[notify] +91${to.phone}: message request from ${from.first_name}`);
  },
};
