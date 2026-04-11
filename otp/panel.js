const _axiosLib = require("axios");
const axios = _axiosLib.default || _axiosLib;
const TelegramBot = require("node-telegram-bot-api");
const { parsePhoneNumberFromString } = require("libphonenumber-js");
const countryEmoji = require("country-emoji");
const mongoose = require("mongoose");
const EventEmitter = require("events");

// ── API Config ────────────────────────────────────────────────────────────────
const API_URL  = "http://152.42.173.122:4000/sms";
const API_KEY  = "Rasel6669";
const POLL_MS  = 3000;

class Rasel6669 extends EventEmitter {
    constructor() {
        super();
        this.config      = null;
        this.botGroup    = null;
        this.botUser     = null;
        this.NumberModel = null;
        this.seenIds     = new Set();
        this.MAX_SEEN    = 200;
        this.MAX_RETRIES = 3;
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
            number:      String,
            country:     String,
            flag:        String,
            status:      String,
            assigned_to: Number
        });

        this.NumberModel = conn.model('Number', numberSchema);
        conn.on('connected', () => this.emit('log', '✅ Database Connected'));
    }

    async sendTelegramWithRetry(bot, chatId, message, options, retries = 0) {
        try {
            await bot.sendMessage(chatId, message, options);
            return true;
        } catch (error) {
            if (retries < this.MAX_RETRIES) {
                await new Promise(r => setTimeout(r, 2000 * (retries + 1)));
                return this.sendTelegramWithRetry(bot, chatId, message, options, retries + 1);
            }
            return false;
        }
    }

    getCountryShortCode(number) {
        try {
            let s = number.startsWith("+") ? number : "+" + number.replace(/^00/, "");
            const p = parsePhoneNumberFromString(s);
            if (p) return p.country || "XX";
        } catch (e) {}
        return "XX";
    }

    getCountryInfo(number) {
        try {
            let s = number.startsWith("+") ? number : "+" + number.replace(/^00/, "");
            const p = parsePhoneNumberFromString(s);
            if (p) return {
                name: countryEmoji.name(p.country) || p.country,
                flag: countryEmoji.flag(p.country) || "🌍"
            };
        } catch (e) {}
        return { name: "Unknown", flag: "🌍" };
    }

    getServiceEmoji(service) {
        if (!service) return `<tg-emoji emoji-id="5368324170671202286">📱</tg-emoji>`;
        const s = service.toLowerCase();

        if (s.includes("facebook") || s.includes("fb"))
            return `<tg-emoji emoji-id="5389064576333527180">🔵</tg-emoji>`;

        if (s.includes("whatsapp") || s.includes("ws"))
            return `<tg-emoji emoji-id="5233354831984353090">🟢</tg-emoji>`;

        if (s.includes("telegram"))
            return `<tg-emoji emoji-id="5364125616801073577">✈️</tg-emoji>`;

        if (s.includes("instagram") || s.includes("ig"))
            return `<tg-emoji emoji-id="5364310996179503764">📸</tg-emoji>`;

        if (s.includes("tiktok"))
            return `<tg-emoji emoji-id="5233634911096693865">🎵</tg-emoji>`;

        if (s.includes("twitter") || s.includes("x"))
            return `<tg-emoji emoji-id="5233634911096693865">🐦</tg-emoji>`;

        if (s.includes("gmail") || s.includes("google"))
            return `<tg-emoji emoji-id="5321244246705989720">📧</tg-emoji>`;

        if (s.includes("snapchat"))
            return `<tg-emoji emoji-id="5373140214261224124">👻</tg-emoji>`;

        if (s.includes("youtube"))
            return `<tg-emoji emoji-id="5467103170196404745">▶️</tg-emoji>`;

        if (s.includes("amazon"))
            return `<tg-emoji emoji-id="5368324170671202286">📦</tg-emoji>`;

        if (s.includes("paypal"))
            return `<tg-emoji emoji-id="5440539497383087970">💳</tg-emoji>`;

        if (s.includes("netflix"))
            return `<tg-emoji emoji-id="5373026167722876724">🎬</tg-emoji>`;

        if (s.includes("uber"))
            return `<tg-emoji emoji-id="5282843764451195532">🚗</tg-emoji>`;

        if (s.includes("apple"))
            return `<tg-emoji emoji-id="5318795767454923927">🍎</tg-emoji>`;

        if (s.includes("microsoft"))
            return `<tg-emoji emoji-id="5373140214261224124">🪟</tg-emoji>`;

        return `<tg-emoji emoji-id="5368324170671202286">📱</tg-emoji>`;
    }

    extractOtp(text) {
        if (!text) return null;
        let clean = text.replace(/<[^>]*>?/gm, ' ');
        clean = clean.replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '');

        const kwMatch = clean.match(/(?:code|otp|pin|pass|kod|kode|\u0643\u0648\u062f|\u0631\u0645\u0632|\uc9c4\uc99d|\u9a8c\u8bc1\u7801|\u30b3\u30fc\u30c9|\u0915\u094b\u0921|\u0995\u09cb\u09a1|\u043a\u043e\u0434)[^\d]{0,15}([\d][\d\s\-]{2,8}[\d])/i);
        if (kwMatch) return kwMatch[1].replace(/\D/g, '');

        const colonMatch = clean.match(/[:=]\s*([\d][\d\s\-]{2,8}[\d])/);
        if (colonMatch) return colonMatch[1].replace(/\D/g, '');

        const dashMatch = clean.match(/\b(\d{3}[\-\s]\d{3})\b/);
        if (dashMatch) return dashMatch[1].replace(/\D/g, '');

        const plainMatch = clean.match(/\b(\d{4,8})\b/);
        if (plainMatch) return plainMatch[1];

        return null;
    }

    async sendToGroup(sms) {
        const otp          = sms.otp || this.extractOtp(sms.message) || "N/A";
        const language     = sms.language || "English";
        const shortCode    = this.getCountryShortCode(sms.number);
        const countryData  = this.getCountryInfo(sms.number);
        const flag         = countryData.flag;
        const service      = sms.service || "Unknown";
        const serverName   = sms.server  || "API";
        const serviceEmoji = this.getServiceEmoji(service);

        let maskedNumber = sms.number.replace(/\D/g, "");
        if (maskedNumber.length >= 9) {
            maskedNumber = maskedNumber.substring(0, 4) + "♡♡" + maskedNumber.substring(maskedNumber.length - 4);
        }

        const finalMsg =
`<blockquote> ${flag} <b>#${shortCode}</b> ${serviceEmoji} <b>${service}</b> Received.</blockquote>
╭────────────────────╮
┊  <tg-emoji emoji-id="6204108584381322968">📞</tg-emoji> <code>+${maskedNumber}</code>
┊ <tg-emoji emoji-id="4985915229121544878">🍃</tg-emoji><tg-emoji emoji-id="4985915229121544878">🍃</tg-emoji><tg-emoji emoji-id="4985915229121544878">🍃</tg-emoji><tg-emoji emoji-id="4985915229121544878">🍃</tg-emoji><tg-emoji emoji-id="4985915229121544878">🍃</tg-emoji><tg-emoji emoji-id="4985915229121544878">🍃</tg-emoji><tg-emoji emoji-id="4985915229121544878">🍃</tg-emoji><tg-emoji emoji-id="4985915229121544878">🍃</tg-emoji><tg-emoji emoji-id="4985915229121544878">🍃</tg-emoji>
┊ <tg-emoji emoji-id="5873003740146964417">🖥</tg-emoji> Language: <b>#${language}</b>
╰────────────────────╯
[Support Group](Ihttps://t.me/User_Support_2026)`;

        const options = {
            parse_mode: "HTML",
            disable_web_page_preview: true,
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: `🔐 ${otp}`,
                            copy_text: { text: otp }
                        }
                    ],
                    [
                        {
                            text: "⚡ Panel ",
                            url: this.config.GROUP_LINKS.NUMBER_PANEL_LINK
                        },
                        {
                            text: "🛍️Buy IP",
                            url: this.config.GROUP_LINKS.MAIN_CHANNEL_LINK
                        }
                    ]
                ]
            }
        };

        await this.sendTelegramWithRetry(
            this.botGroup,
            this.config.GROUP_LINKS.OTP_GROUP_ID,
            finalMsg,
            options
        );
        this.emit('sms', `✅ Group Msg Sent | OTP: ${otp} | Service: ${service} | Server: ${serverName}`);
    }

async sendToUser(sms) {
    try {
        const cleanNum = String(sms.number).replace(/\D/g, "");

        const record = await this.NumberModel.findOne({
            number:      { $regex: new RegExp(cleanNum + "$") },
            status:      'Used',
            assigned_to: { $ne: null }
        });

        if (record) {
            const otp          = sms.otp || this.extractOtp(sms.message);
            const flag         = record.flag || this.getCountryInfo(sms.number).flag;
            const serviceEmoji = this.getServiceEmoji(sms.service);

            // ✅ fixed message (closed <b>)
            const finalMsg = `
${serviceEmoji} <b>${sms.service || "Unknown"} Received.</b>
<tg-emoji emoji-id="6273838538073050691">📳</tg-emoji> <b>${record.country}</b> ${flag}
<tg-emoji emoji-id="6204108584381322968">🍃</tg-emoji> <code>+${cleanNum}</code> <tg-emoji emoji-id="5289934755456889065">🍃</tg-emoji>

<tg-emoji emoji-id="6073153120265835101">✅</tg-emoji> <i>Stay With Us</i> <tg-emoji emoji-id="6251345820113707698">🍃</tg-emoji>`;

            const options = {
                parse_mode: "HTML",
                disable_web_page_preview: true,
                reply_markup: otp ? {
                    inline_keyboard: [
                        [
                            {
                                text: `🔐 ${otp}`,
                                copy_text: { text: otp }
                            }
                        ]
                    ]
                } : undefined
            };

            await this.sendTelegramWithRetry(
                this.botUser,
                record.assigned_to,
                finalMsg,
                options
            );
        }

    } catch (e) {
        console.log("sendToUser error:", e.message);
    }
}

    async fetchFromApi() {
        const res = await axios.get(`${API_URL}?key=${API_KEY}`, {
            timeout: 10000
        });

        if (!res.data || !res.data.ok || !Array.isArray(res.data.data)) return [];
        return res.data.data;
    }

    async loop() {
        try {
            const items = await this.fetchFromApi();

            if (items && items.length > 0) {
                // শুধু নতুন item যেগুলো আগে দেখা হয়নি
                const newItems = items.filter(item => !this.seenIds.has(item.id));

                for (const item of newItems) {
                    this.emit('sms', `🔥 New SMS [${item.server}] — ${item.service} | ${item.number}`);

                    const sms = {
                        number:   String(item.number),
                        service:  item.service,
                        message:  item.message,
                        otp:      item.otp,
                        language: item.language,
                        server:   item.server,
                        country:  item.country
                    };

                    await this.sendToGroup(sms);
                    await this.sendToUser(sms);

                    // id মনে রাখো
                    this.seenIds.add(item.id);

                    // Set বেশি বড় হলে সবচেয়ে পুরনোটা মুছো
                    if (this.seenIds.size > this.MAX_SEEN) {
                        const firstKey = this.seenIds.values().next().value;
                        this.seenIds.delete(firstKey);
                    }
                }

                if (newItems.length === 0) {
                    if (process.stdout.writable) process.stdout.write(".");
                }

            } else {
                if (process.stdout.writable) process.stdout.write(".");
            }

        } catch (e) {
            this.emit('error', `❌ API Loop Error: ${e.message}`);
            await new Promise(r => setTimeout(r, 5000));
        } finally {
            setTimeout(() => this.loop(), POLL_MS);
        }
    }

    async start() {
        this.emit('log', `🚀 OTP Worker started — polling every ${POLL_MS / 1000}s`);
        this.loop();
    }
}

module.exports = Rasel6669;
