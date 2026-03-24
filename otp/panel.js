const TelegramBot = require("node-telegram-bot-api");
const { parsePhoneNumberFromString } = require("libphonenumber-js");
const countryEmoji = require("country-emoji");
const mongoose = require("mongoose");
const EventEmitter = require("events");
const axios = require("axios").default;

class OtpWorker extends EventEmitter {
    constructor() {
        super();
        this.config      = null;
        this.botGroup    = null;
        this.botUser     = null;
        this.NumberModel = null;
        this.seenIds     = {};

        this.API_URL = "https://alif-sms-panel-api.vercel.app";
        this.API_KEY = "Rasel6669";

        this.SMS_LIMIT   = 10;
        this.MAX_RETRIES = 3;
        this.MAX_BACKOFF = 30000;
        this.errorCount  = 0;
        this._sseActive  = false;
        this._initialized = false;
        this._fallbackTimer = null;
    }

    setConfig(config) {
        this.config = config;
        this.initializeBots();
        this.initializeDatabase();
    }

    initializeBots() {
        const opts = { polling: false, request: { timeout: 30000 } };
        this.botGroup = new TelegramBot(this.config.BOT_TOKENS.NOTIFICATION_BOT, opts);
        this.botUser  = new TelegramBot(this.config.BOT_TOKENS.USER_BOT, opts);
        this.emit('log', '✅ Bots initialized');
    }

    initializeDatabase() {
        const conn = mongoose.createConnection(this.config.NUMBER_DB_URI, {
            serverSelectionTimeoutMS: 30000,
            family: 4,
            maxPoolSize: 10,
        });
        const numberSchema = new mongoose.Schema({
            number: String, country: String, flag: String,
            status: String, assigned_to: Number
        });
        this.NumberModel = conn.model('Number', numberSchema);
        conn.on('connected', () => this.emit('log', '✅ Database Connected'));
    }

    // ─── HTTP fetch (init + fallback poll) ───────────────────────────────────
    async fetchAllSms(attempt = 0) {
        try {
            const res = await axios.get(`${this.API_URL}/sms`, {
                headers: { "x-api-key": this.API_KEY },
                params:  { limit: this.SMS_LIMIT },
                timeout: 15000
            });
            return res.data?.ok ? (res.data.data || []) : [];
        } catch (err) {
            const retryable = ["ECONNRESET","ETIMEDOUT","ECONNABORTED","ECONNREFUSED"].includes(err.code);
            if (retryable && attempt < this.MAX_RETRIES) {
                await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
                return this.fetchAllSms(attempt + 1);
            }
            if (err.message?.includes("timeout") || err.code === "ECONNABORTED") {
                if (!this._initialized) throw err;
                return [];
            }
            throw err;
        }
    }

    // ─── SSE connect ─────────────────────────────────────────────────────────
    // api.js তে /events endpoint থাকলে এটা connect করবে
    // নতুন SMS আসলে api.js push করবে, bot সাথে সাথে পাবে
    connectSSE() {
        if (this._sseActive) return;
        this._sseActive = true;

        const url = `${this.API_URL}/events?key=${this.API_KEY}&limit=${this.SMS_LIMIT}`;
        this.emit('log', `📡 SSE connecting → ${url}`);

        // Node.js এ native SSE client নেই, তাই axios stream use করি
        axios({
            method: 'GET',
            url,
            responseType: 'stream',
            timeout: 0,  // no timeout — persistent connection
            headers: {
                "x-api-key": this.API_KEY,
                "Accept": "text/event-stream",
                "Cache-Control": "no-cache"
            }
        }).then(res => {
            this.emit('log', '✅ SSE connected — real-time mode active');
            // fallback poll বন্ধ করো
            if (this._fallbackTimer) { clearInterval(this._fallbackTimer); this._fallbackTimer = null; }

            let buf = "";
            res.data.on('data', chunk => {
                buf += chunk.toString();
                const lines = buf.split("\n");
                buf = lines.pop(); // incomplete line টা রেখে দাও

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith("data:")) continue;
                    const jsonStr = trimmed.slice(5).trim();
                    if (!jsonStr || jsonStr === "ping") continue;
                    try {
                        const rows = JSON.parse(jsonStr);
                        const arr = Array.isArray(rows) ? rows : [rows];
                        for (const row of arr) {
                            if (String(row.id) !== "0" && !this._isSeen(row)) {
                                this.emit('log', `🔥 SSE push [${row.server}] OTP=${row.otp||"?"}`);
                                Promise.allSettled([
                                    this.sendToGroup(row),
                                    this.sendToUser(row)
                                ]);
                                this._markSeen(row);
                            }
                        }
                    } catch(e) { /* invalid json, skip */ }
                }
            });

            res.data.on('end', () => {
                this.emit('log', '⚠️ SSE disconnected — reconnecting in 3s...');
                this._sseActive = false;
                setTimeout(() => this.connectSSE(), 3000);
                this.startFallbackPoll(); // reconnect এর আগ পর্যন্ত poll করো
            });

            res.data.on('error', err => {
                this.emit('log', `⚠️ SSE error: ${err.message} — reconnecting in 5s...`);
                this._sseActive = false;
                setTimeout(() => this.connectSSE(), 5000);
                this.startFallbackPoll();
            });

        }).catch(err => {
            this._sseActive = false;
            // SSE endpoint নেই (api.js পুরানো) → fallback poll mode
            if (err.response?.status === 404 || err.response?.status === 405) {
                this.emit('log', `⚠️ SSE not supported by API — switching to poll mode (20s)`);
                this.startFallbackPoll();
            } else {
                this.emit('log', `⚠️ SSE failed: ${err.message} — retry in 5s`);
                setTimeout(() => this.connectSSE(), 5000);
                this.startFallbackPoll();
            }
        });
    }

    // ─── Fallback poll (SSE না থাকলে বা disconnect হলে) ─────────────────────
    startFallbackPoll() {
        if (this._fallbackTimer) return; // already running
        this.emit('log', '🔄 Fallback poll mode: 20s interval');
        this._fallbackTimer = setInterval(async () => {
            try {
                const rows = await this.fetchAllSms();
                const newRows = rows.filter(r => String(r.id) !== "0" && !this._isSeen(r));
                if (newRows.length > 0) {
                    this.emit('log', `🔥 Poll: ${newRows.length} new OTP(s)`);
                    await Promise.allSettled(newRows.map(async row => {
                        try {
                            await Promise.allSettled([this.sendToGroup(row), this.sendToUser(row)]);
                        } catch(e) {}
                        this._markSeen(row);
                    }));
                }
            } catch(e) {
                this.emit('log', `⚠️ Poll error: ${e.message}`);
            }
        }, 20000);
    }

    // ─── Telegram helpers ────────────────────────────────────────────────────
    async sendTelegramWithRetry(bot, chatId, message, options, retries = 0) {
        try {
            await bot.sendMessage(chatId, message, options);
            return true;
        } catch (error) {
            if (retries < this.MAX_RETRIES) {
                await new Promise(r => setTimeout(r, 1000 * (retries + 1)));
                return this.sendTelegramWithRetry(bot, chatId, message, options, retries + 1);
            }
            this.emit('log', `⚠️ Telegram send failed: ${error.message}`);
            return false;
        }
    }

    extractOtp(text) {
        if (!text) return null;
        const clean = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        const kwMatch = clean.match(
            /(?:otp|code|pin|passcode|verification\s*code|verify|token|কোড|رمز|код)\s*[:\-–—is]*\s*(\d{4,8})/i
        );
        if (kwMatch) return kwMatch[1];
        const dashMatch = clean.match(/\b(\d{3}-\d{3})\b/);
        if (dashMatch) return dashMatch[1];
        const sentenceMatch = clean.match(/(?:your|is|:)\s*(\d{4,8})(?:\s|$|\.)/i);
        if (sentenceMatch) return sentenceMatch[1];
        const standalone = clean.match(/\b(\d{4,8})\b/);
        return standalone ? standalone[1] : null;
    }

    async sendToGroup(row) {
        const isDummy     = String(row.number) === "0";
        const rawMessage  = row.message || "";
        const otp         = row.otp || this.extractOtp(rawMessage) || "";
        const countryName = row.country || "Unknown";
        const flag        = isDummy ? "🌍" : this.getFlag(row.number);
        const serverName  = row.server || "Unknown";
        const number      = isDummy ? "0" : String(row.number);
        const message     = isDummy ? "0" : rawMessage;
        const service     = row.service || 0;

        let maskedNumber = number;
        if (!isDummy && maskedNumber.length >= 7) {
            maskedNumber = maskedNumber.substring(0, 6) + "𝚂𝙼𝚂" + maskedNumber.substring(maskedNumber.length - 4);
        }

        const finalMsg =
`✅ ${flag} <b>${countryName} ${service} Otp Code Received Successfully</b> 🎉

🔐 <b>𝗬𝗼𝘂𝗿 𝗢𝗧𝗣:</b>  <code>${otp}</code>

☎️ <b>Number:</b> <code>${maskedNumber}</code>
⚙️ <b>Service:</b> ${service}
🌍 <b>Country:</b> ${countryName} ${flag}

📩 <b>𝗙𝘂𝗹𝗹-𝗠𝗲𝘀𝘀𝗮𝗴𝗲:</b>
<pre>${message}</pre>`;

        const opts = {
            parse_mode: "HTML",
            disable_web_page_preview: true,
            reply_markup: {
                inline_keyboard: [[
                    { text: "🚀 Panel", url: this.config.GROUP_LINKS.NUMBER_PANEL_LINK },
                    { text: "Buy IP",   url: this.config.GROUP_LINKS.MAIN_CHANNEL_LINK }
                ]]
            }
        };

        try {
            const sent = await this.botGroup.sendMessage(this.config.GROUP_LINKS.OTP_GROUP_ID, finalMsg, opts);
            if (isDummy && sent?.message_id) {
                setTimeout(async () => {
                    try { await this.botGroup.deleteMessage(this.config.GROUP_LINKS.OTP_GROUP_ID, sent.message_id); }
                    catch(e) {}
                }, 5000);
            }
        } catch (error) {
            this.emit('log', `⚠️ Group send failed: ${error.message}`);
        }
        this.emit('sms', `✅ Sent [${serverName}] OTP=${otp || "(empty)"}`);
    }

    async sendToUser(row) {
        try {
            if (String(row.number) === "0") return;
            if (!this.NumberModel) return;
            const cleanNum = String(row.number).replace(/\D/g, "");
            const record   = await this.NumberModel.findOne({
                number:      { $regex: new RegExp(cleanNum + "$") },
                status:      'Used',
                assigned_to: { $ne: null }
            }).lean();
            if (!record) return;
            const flag = record.flag || this.getFlag(row.number);
            const otp  = row.otp || this.extractOtp(row.message) || "";
            const finalMsg =
`🌎 Country : ${record.country} ${flag}
📢 Number : <code>${cleanNum}</code>
${otp ? `🔐 OTP : <code>${otp}</code>` : ""}

✅ Stay With Us.💖`;
            await this.sendTelegramWithRetry(this.botUser, record.assigned_to, finalMsg, { parse_mode: "HTML" });
        } catch(e) {
            this.emit('log', `⚠️ sendToUser error: ${e.message}`);
        }
    }

    getFlag(number) {
        try {
            const s = String(number).startsWith("+") ? String(number) : "+" + String(number).replace(/^00/, "");
            const p = parsePhoneNumberFromString(s);
            if (p) return countryEmoji.flag(p.country) || "🌍";
        } catch(e) {}
        return "🌍";
    }

    _rowKey(row)  { return `${row.id}_${row.number}_${row.date}`; }
    _isSeen(row)  { return this.seenIds[row.server]?.has(this._rowKey(row)) || false; }
    _markSeen(row) {
        const sid = row.server;
        if (!this.seenIds[sid]) this.seenIds[sid] = new Set();
        this.seenIds[sid].add(this._rowKey(row));
        if (this.seenIds[sid].size > 500) {
            this.seenIds[sid].clear();
            this.seenIds[sid].add(this._rowKey(row));
        }
    }

    async start() {
        this.emit('log', `🚀 OtpWorker | API: ${this.API_URL}`);

        // Step 1: init — existing rows mark করো
        try {
            const rows = await this.fetchAllSms();
            this.emit('log', `📋 Init: ${rows.length} existing row(s) marked as seen`);
            for (const row of rows) this._markSeen(row);
            this._initialized = true;
            this.emit('log', `✅ Init done — connecting SSE for real-time push...`);
        } catch(e) {
            this.emit('log', `⚠️ Init fetch failed: ${e.message} — starting anyway`);
            this._initialized = true;
        }

        // Step 2: SSE connect (instant push)
        // SSE না থাকলে auto fallback to poll
        this.connectSSE();
    }
}

module.exports = OtpWorker;
