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

        // ✅ FIX 1: প্রতি server এ শুধু একটা ID না, Set এ সব seen ID রাখো
        // key: serverId → Set of "id_number" strings
        this.seenIds = {};

        this.API_URL = "https://alif-sms-panel-api.vercel.app";
        this.API_KEY = "Rasel6669";

        // ✅ FIX 2: limit=5 — 18s cache window এ যে কয়টা SMS আসতে পারে সব নিয়ে আসো
        this.SMS_LIMIT = 5;

        this.MAX_RETRIES   = 3;
        // ✅ FIX 3: POLL_INTERVAL = 18s — API cache এর সাথে sync রাখো
        // 2s এ poll করলে বারবার same cache পাবে, কিছু লাভ নেই
        // 18s এ poll করলে প্রতিবার fresh data পাবে
        this.POLL_INTERVAL = 18000;
        this.MAX_BACKOFF   = 30000;
        this.errorCount    = 0;
        this._loopRunning  = false;
        this._initialized  = false;
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

    // ✅ FIX 4: limit parameter পাঠাও — default 1 এর বদলে SMS_LIMIT
    async fetchAllSms(attempt = 0) {
        try {
            const res = await axios.get(`${this.API_URL}/sms`, {
                headers: { "x-api-key": this.API_KEY },
                params:  { limit: this.SMS_LIMIT },   // ← এটাই আসল fix
                timeout: 20000
            });
            return res.data?.ok ? (res.data.data || []) : [];
        } catch (err) {
            const retryable = [
                "ECONNRESET","ETIMEDOUT","ECONNABORTED","ECONNREFUSED"
            ].includes(err.code);

            if (retryable && attempt < this.MAX_RETRIES) {
                const delay = Math.min(3000 * (attempt + 1), this.MAX_BACKOFF);
                this.emit('log', `⚠️ API retry ${attempt + 1} in ${delay / 1000}s`);
                await new Promise(r => setTimeout(r, delay));
                return this.fetchAllSms(attempt + 1);
            }

            if (err.code === "ECONNABORTED" || err.message?.includes("timeout")) {
                if (!this._initialized) throw err;
                this.emit('log', `⏱️ API timeout — skipping cycle`);
                return [];
            }

            throw err;
        }
    }

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

        // Priority 1: keyword এর পরে OTP number
        const kwMatch = clean.match(
            /(?:otp|code|pin|passcode|verification\s*code|verify|token|কোড|رمز|код)\s*[:\-–—is]*\s*(\d{4,8})/i
        );
        if (kwMatch) return kwMatch[1];

        // Priority 2: "NNN-NNN" dash format (e.g. WhatsApp: 519-274)
        const dashMatch = clean.match(/\b(\d{3}-\d{3})\b/);
        if (dashMatch) return dashMatch[1];

        // Priority 3: "your X code is NNNN" pattern
        const sentenceMatch = clean.match(/(?:your|is|:)\s*(\d{4,8})(?:\s|$|\.)/i);
        if (sentenceMatch) return sentenceMatch[1];

        // Priority 4: standalone 4-8 digit number (fallback)
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
            const sent = await this.botGroup.sendMessage(
                this.config.GROUP_LINKS.OTP_GROUP_ID,
                finalMsg,
                opts
            );

            if (isDummy && sent?.message_id) {
                setTimeout(async () => {
                    try {
                        await this.botGroup.deleteMessage(
                            this.config.GROUP_LINKS.OTP_GROUP_ID,
                            sent.message_id
                        );
                    } catch (delErr) {
                        this.emit('log', `⚠️ Delete failed: ${delErr.message}`);
                    }
                }, 5000);
            }

        } catch (error) {
            this.emit('log', `⚠️ Telegram send failed: ${error.message}`);
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

            await this.sendTelegramWithRetry(
                this.botUser,
                record.assigned_to,
                finalMsg,
                { parse_mode: "HTML" }
            );
        } catch (e) {
            this.emit('log', `⚠️ sendToUser error: ${e.message}`);
        }
    }

    getFlag(number) {
        try {
            const s = String(number).startsWith("+") ? String(number) : "+" + String(number).replace(/^00/, "");
            const p = parsePhoneNumberFromString(s);
            if (p) return countryEmoji.flag(p.country) || "🌍";
        } catch (e) {}
        return "🌍";
    }

    // ✅ FIX 5: একটা row এর unique key — id + number + date সব মিলিয়ে
    _rowKey(row) {
        return `${row.id}_${row.number}_${row.date}`;
    }

    // ✅ FIX 6: seenIds Set এ row দেখা হয়েছে কিনা চেক করো
    _isSeen(row) {
        const sid = row.server;
        if (!this.seenIds[sid]) return false;
        return this.seenIds[sid].has(this._rowKey(row));
    }

    // ✅ FIX 7: seenIds Set এ row mark করো
    // Set size বেশি বাড়লে (1000+) পুরানো clear করো যাতে memory leak না হয়
    _markSeen(row) {
        const sid = row.server;
        if (!this.seenIds[sid]) this.seenIds[sid] = new Set();
        this.seenIds[sid].add(this._rowKey(row));
        // memory guard: 500 এর বেশি হলে সব clear (পুরানো ID গুলো আর দরকার নেই)
        if (this.seenIds[sid].size > 500) {
            this.seenIds[sid].clear();
            this.seenIds[sid].add(this._rowKey(row));
        }
    }

    async loop() {
        if (this._loopRunning) return;
        this._loopRunning = true;

        try {
            const rows = await this.fetchAllSms();

            if (!this._initialized) {
                this.emit('log', `🚀 Bot started — ${rows.length} row(s) found, marking as seen...`);

                // Init এ শুধু mark করো — পাঠাবে না (পুরানো OTP spam এড়াতে)
                for (const row of rows) {
                    this._markSeen(row);
                }

                this._initialized = true;
                this.emit('log', `✅ Init done — now listening for NEW OTPs (limit=${this.SMS_LIMIT})...`);

            } else {
                // ✅ Dummy row (id=0) বাদ দিয়ে নতুন row filter করো
                const newRows = rows.filter(row =>
                    String(row.id) !== "0" && !this._isSeen(row)
                );

                if (newRows.length > 0) {
                    this.emit('log', `🔥 ${newRows.length} new SMS found!`);
                    await Promise.allSettled(newRows.map(async row => {
                        this.emit('sms', `🔥 New SMS [${row.server}] OTP=${row.otp || "(empty)"}`);
                        try {
                            await Promise.allSettled([
                                this.sendToGroup(row),
                                this.sendToUser(row)
                            ]);
                        } catch (sendErr) {
                            this.emit('log', `⚠️ Send error [${row.server}]: ${sendErr.message}`);
                        }
                        this._markSeen(row);
                    }));
                } else {
                    if (process.stdout.writable) process.stdout.write(".");
                }
            }

            this.errorCount = 0;

        } catch (e) {
            this.errorCount++;
            if (this.errorCount === 1 || this.errorCount % 5 === 0) {
                this.emit('error', `Loop Error: ${e.message} (fail #${this.errorCount})`);
            }
        } finally {
            this._loopRunning = false;
            const delay = this.errorCount > 0
                ? Math.min(3000 * this.errorCount, this.MAX_BACKOFF)
                : this.POLL_INTERVAL;
            setTimeout(() => this.loop(), delay);
        }
    }

    async start() {
        this.emit('log', `🚀 OtpWorker started → API: ${this.API_URL} | limit=${this.SMS_LIMIT} | poll=${this.POLL_INTERVAL/1000}s`);
        this.loop();
    }
}

module.exports = OtpWorker;
