// PSCall SMS CDR → Telegram Bot
// ================================
// npm install axios libphonenumber-js country-emoji
// node index.js

const axios = require("axios");
const { parsePhoneNumberFromString } = require("libphonenumber-js");
const countryEmoji = require("country-emoji");

// ===================== GLOBAL CONFIG =====================
const config = {
  API_KEY:      "SFBUSD1SS4N6hICFR1RYSkE=",
  BASE_URL:     "http://pscall.net/restapi/smsreport",
  TG_BOT_TOKEN: "8434361736:AAEQgkRvevH1OxHwLx4iJXo-eE38lQZlH2w",
  TG_CHAT_ID:   "-1003748109602",
  POLL_SEC:     3,
  GROUP_LINKS: {
    NUMBER_PANEL_LINK: "https://t.me/OTP_Fast7_Bot",   
    MAIN_CHANNEL_LINK: "https://t.me/Group_owner_Rasel", // আপনার Channel link
  },
};
// =========================================================

const seenKeys = new Set();
let isFirstRun = true;

// ─── Number Masking ───────────────────────────────────
function maskNumber(num) {
  if (!num) return "—";
  const s = String(num).replace(/\D/g, "");
  if (s.length <= 7) return s;
  return `${s.slice(0, 5)}•••${s.slice(-4)}`;
}

// ─── Country Detection ────────────────────────────────
function detectCountry(num) {
  if (!num) return { name: "Unknown", flag: "🌍" };
  try {
    const phone = parsePhoneNumberFromString("+" + String(num).replace(/\D/g, ""));
    if (phone && phone.country) {
      const name = new Intl.DisplayNames(["en"], { type: "region" }).of(phone.country) || phone.country;
      const flag = countryEmoji.flag(phone.country) || "🌍";
      return { name, flag };
    }
  } catch (_) {}
  return { name: "Unknown", flag: "🌍" };
}

// ─── OTP Detection ───────────────────────────────────
function extractOTP(sms) {
  if (!sms) return null;
  const dashMatch = sms.match(/\b(\d{3,4})-(\d{3,4})\b/);
  if (dashMatch) return dashMatch[1] + dashMatch[2];
  for (const p of [/\b(\d{8})\b/, /\b(\d{7})\b/, /\b(\d{6})\b/, /\b(\d{5})\b/, /\b(\d{4})\b/]) {
    const m = sms.match(p);
    if (m) return m[1];
  }
  return null;
}

// ─── Message Builder ─────────────────────────────────
function buildMessage(r) {
  const country = detectCountry(r.num);
  const otp     = extractOTP(r.sms);
  const service = r.cli || "Unknown";

  let text = `<b>${country.flag} ${country.name} ${service} Code Received Successfully 🎉</b>\n\n`;
  if (otp) text += `🔐 𝗬𝗼𝘂𝗿 𝗢𝗧𝗣:  <code>${otp}</code>\n\n`;
  text += `☎️ Number: <code>${maskNumber(r.num)}</code>\n`;
  text += `⚙️ Service: ${service}\n`;
  text += `🌍 Country: ${country.name} ${country.flag}\n\n`;
  text += `📩 𝗙𝘂𝗹𝗹-𝗠𝗲𝘀𝘀𝗮𝗴𝗲:\n<pre>${(r.sms || "—").substring(0, 800)}</pre>`;

  const options = {
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🚀 Panel",      url: config.GROUP_LINKS.NUMBER_PANEL_LINK },
          { text: "📞All Number",  url: config.GROUP_LINKS.MAIN_CHANNEL_LINK },
        ],
      ],
    },
  };

  return { text, options };
}

// ─── API Fetch ────────────────────────────────────────
async function fetchRecords(start = 0, length = 50) {
  try {
    const resp = await axios.get(config.BASE_URL, {
      params: { key: config.API_KEY, start, length },
      timeout: 15000,
    });
    const data = resp.data;
    if (data.result !== "success") {
      console.error(`[ERROR] API: ${data.result}`);
      return [];
    }
    return data.data || [];
  } catch (err) {
    console.error(`[ERROR] API: ${err.message}`);
    return [];
  }
}

// ─── Telegram Send ────────────────────────────────────
async function sendTelegram(r) {
  const { text, options } = buildMessage(r);
  try {
    await axios.post(
      `https://api.telegram.org/bot${config.TG_BOT_TOKEN}/sendMessage`,
      { chat_id: config.TG_CHAT_ID, text, ...options }
    );
  } catch (err) {
    console.error(`[ERROR] Telegram: ${err.message}`);
  }
}

async function sendText(text) {
  try {
    await axios.post(
      `https://api.telegram.org/bot${config.TG_BOT_TOKEN}/sendMessage`,
      { chat_id: config.TG_CHAT_ID, text, parse_mode: "HTML" }
    );
  } catch (err) {
    console.error(`[ERROR] Telegram: ${err.message}`);
  }
}

function makeKey(r) {
  return `${r.dateadded}|${r.num}|${r.sms}`;
}

// ─── Main Poll ────────────────────────────────────────
async function poll() {
  if (isFirstRun) {
    console.log("╔══════════════════════════════════════╗");
    console.log("║   PSCall OTP Bot চালু হয়েছে 🚀      ║");
    console.log("╚══════════════════════════════════════╝");
    console.log(`⏱  প্রতি ${config.POLL_SEC} সেকেন্ডে চেক হবে\n`);

    const records = await fetchRecords(0, 100);
    records.forEach((r) => seenKeys.add(makeKey(r)));
    console.log(`✅ ${records.length} `);

    if (records.length > 0) {
      const latest = records[0];
      await sendTelegram(latest);
      const country = detectCountry(latest.num);
      const otp = extractOTP(latest.sms);
      console.log(`📨 পাঠানো → ${country.flag} ${maskNumber(latest.num)} | OTP: ${otp || "—"}`);
    } else {
      await sendText("✅on");
    }

    isFirstRun = false;
    return;
  }

  const records = await fetchRecords(0, 50);
  const newRecords = [];

  for (const r of records) {
    const key = makeKey(r);
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      newRecords.push(r);
    }
  }

  const now = new Date().toLocaleTimeString("en-GB");

  if (newRecords.length > 0) {
    console.log(`[${now}] 🆕 ${newRecords.length} টি নতুন!`);
    for (const r of newRecords) {
      const country = detectCountry(r.num);
      const otp = extractOTP(r.sms);
      await sendTelegram(r);
      console.log(`  📨 ${country.flag} ${maskNumber(r.num)} | OTP: ${otp || "—"} | ${r.cli}`);
    }
  } else {
    console.log(`[${now}] কোনো নতুন রেকর্ড নেই।`);
  }
}

// চালু
poll().then(() => {
  setInterval(poll, config.POLL_SEC * 1000);
});
