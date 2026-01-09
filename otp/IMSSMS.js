/**
 * OTP WORKER 2 - SMS Panel Monitoring (Multi-User)
 * Server: imssms.org (HTTPS)
 */

const axios = require("axios").default;
const tough = require("tough-cookie");
const { wrapper } = require("axios-cookiejar-support");
const cheerio = require("cheerio");
const TelegramBot = require("node-telegram-bot-api");
const { parsePhoneNumberFromString } = require("libphonenumber-js");
const countryEmoji = require("country-emoji");
const mongoose = require("mongoose");
const EventEmitter = require("events");

class OtpWorker2 extends EventEmitter {
    constructor() {
        super();
        this.config = null;
        this.botGroup = null;
        this.botUser = null;
        this.NumberModel = null;

        // Multiple users configuration
        this.users = [
            {
                username: "Rasel002",
                password: "Rasel002",
                lastId: null,
                currentUA: null,
                jar: null,
                client: null
            }

        ];

        this.GLOBAL_USER_AGENTS = [
            "Mozilla/5.0 (Linux; Android 15; Infinix X6858) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.102 Mobile Safari/537.36",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
        ];

        // Server Configuration
        this.BASE_DOMAIN = "imssms.org";
        this.BASE_URL = `https://${this.BASE_DOMAIN}`;
        this.LOGIN_PAGE_URL = `${this.BASE_URL}/login`;
        this.LOGIN_POST_URL = `${this.BASE_URL}/signin`;
        this.DASHBOARD_URL = `${this.BASE_URL}/client/SMSCDRStats`;
        this.API_BASE_URL = `${this.BASE_URL}/client/res/data_smscdr.php`;

        this.UA_JSON_URL = "https://alifhosson-json-api.vercel.app/data/allua99999B.json";

        // Message queue for rate limiting
        this.messageQueue = [];
        this.isProcessingQueue = false;
        this.MIN_MESSAGE_DELAY = 100;
    }

    setConfig(config) {
        this.config = config;
        this.initializeBots();
        this.initializeDatabase();
    }

    initializeBots() {
        try {
            const botOptions = {
                polling: false,
                request: {
                    agentOptions: {
                        keepAlive: true,
                        keepAliveMsecs: 10000
                    },
                    timeout: 30000
                }
            };

            this.botGroup = new TelegramBot(this.config.BOT_TOKENS.NOTIFICATION_BOT, botOptions);
            this.botUser = new TelegramBot(this.config.BOT_TOKENS.USER_BOT, botOptions);
            this.emit('log', '✅ Bots initialized successfully');
        } catch (e) {
            this.emit('error', `Bot initialization failed: ${e.message}`);
        }
    }

    initializeDatabase() {
        const numberSchema = new mongoose.Schema({
            number: { type: String, unique: true, required: true },
            country: { type: String, required: true },
            flag: { type: String, default: "🌍" },
            status: { type: String, enum: ['Available', 'Used', 'Used_History'], default: 'Available' },
            assigned_to: { type: Number, default: null },
            assigned_at: { type: Date, default: null },
            created_at: { type: Date, default: Date.now }
        });

        const dbOptions = {
            serverSelectionTimeoutMS: 30000,
            socketTimeoutMS: 45000,
            family: 4,
            maxPoolSize: 100,
            minPoolSize: 5,
        };

        const conn = mongoose.createConnection(this.config.NUMBER_DB_URI, dbOptions);

        conn.on('connected', () => {
            this.emit('log', '✅ Database connected');
        });

        conn.on('error', (err) => {
            this.emit('error', `Database error: ${err.message}`);
        });

        this.NumberModel = conn.model('Number', numberSchema);
    }

    async updateUserAgents() {
        try {
            const response = await axios.get(this.UA_JSON_URL);
            if (Array.isArray(response.data) && response.data.length > 0) {
                this.GLOBAL_USER_AGENTS = response.data;
                this.emit('log', `Loaded ${this.GLOBAL_USER_AGENTS.length} User Agents`);
            }
        } catch (error) {
            this.emit('log', '⚠️ Using default User Agents');
        }
    }

    getRandomUA() {
        return this.GLOBAL_USER_AGENTS[Math.floor(Math.random() * this.GLOBAL_USER_AGENTS.length)];
    }

    getTodayDate() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    getApiUrl() {
        const today = this.getTodayDate();
        const fdate1 = encodeURIComponent(`${today} 00:00:00`);
        const fdate2 = encodeURIComponent(`${today} 23:59:59`);
        return `${this.API_BASE_URL}?fdate1=${fdate1}&fdate2=${fdate2}&frange=&fnum=&fcli=&fgdate=&fgmonth=&fgrange=&fgnumber=&fgcli=&fg=0&sEcho=1&iColumns=7&sColumns=%2C%2C%2C%2C%2C%2C&iDisplayStart=0&iDisplayLength=25&mDataProp_0=0&sSearch_0=&bRegex_0=false&bSearchable_0=true&bSortable_0=true&mDataProp_1=1&sSearch_1=&bRegex_1=false&bSearchable_1=true&bSortable_1=true&mDataProp_2=2&sSearch_2=&bRegex_2=false&bSearchable_2=true&bSortable_2=true&mDataProp_3=3&sSearch_3=&bRegex_3=false&bSearchable_3=true&bSortable_3=true&mDataProp_4=4&sSearch_4=&bRegex_4=false&bSearchable_4=true&bSortable_4=true&mDataProp_5=5&sSearch_5=&bRegex_5=false&bSearchable_5=true&bSortable_5=true&mDataProp_6=6&sSearch_6=&bRegex_6=false&bSearchable_6=true&bSortable_6=true&sSearch=&bRegex=false&iSortCol_0=0&sSortDir_0=desc&iSortingCols=1`;
    }

    extractOtp(text) {
        if (!text) return null;
        const matchHyphen = text.match(/(\d{3})[\s-](\d{3})/);
        if (matchHyphen) return matchHyphen[1] + matchHyphen[2];

        const keywordMatch = text.match(/(?:code|otp|pin|verification|vcode|is).*?(\d{4,8})/i);
        if (keywordMatch) return keywordMatch[1];

        const simpleMatch = text.match(/\b\d{3,4}(?:[-\s]?\d{2,4})\b/);
        if (simpleMatch) return simpleMatch[0].replace(/\D/g, "");

        return null;
    }

    getCountryInfo(number) {
        if (!number) return { name: "Unknown", flag: "🌍" };
        let s = String(number).trim().replace(/[^\d+]/g, "");
        if (s.startsWith("00")) s = "+" + s.slice(2);
        if (!s.startsWith("+")) s = "+" + s;
        try {
            const phone = parsePhoneNumberFromString(s);
            if (phone && phone.country) {
                const iso = phone.country;
                return { name: countryEmoji.name(iso) || iso, flag: countryEmoji.flag(iso) || "🌍" };
            }
        } catch (e) {}
        return { name: "Unknown", flag: "🌍" };
    }

    mapRow(row) {
        const msgIndex = 4;
        const rawNumber = row[2] ? String(row[2]) : "";
        const rawMessage = row[msgIndex] ? String(row[msgIndex]) : "";
        const uniqueHash = `${row[0]}_${rawNumber}_${rawMessage}`;

        return {
            id: uniqueHash,
            displayId: row[0],
            number: rawNumber,
            cli: row[3],
            message: rawMessage,
            countryData: this.getCountryInfo(rawNumber),
        };
    }

    async queueMessage(sendFunction) {
        return new Promise((resolve, reject) => {
            this.messageQueue.push({ sendFunction, resolve, reject });
            this.processQueue();
        });
    }

    async processQueue() {
        if (this.isProcessingQueue || this.messageQueue.length === 0) return;
        
        this.isProcessingQueue = true;
        
        while (this.messageQueue.length > 0) {
            const { sendFunction, resolve, reject } = this.messageQueue.shift();
            try {
                const result = await sendFunction();
                resolve(result);
            } catch (error) {
                reject(error);
            }
            await new Promise(res => setTimeout(res, this.MIN_MESSAGE_DELAY));
        }
        
        this.isProcessingQueue = false;
    }

    async sendToGroup(sms, retries = 3) {
        const otp = this.extractOtp(sms.message) || "N/A";
        const { name: countryName, flag } = sms.countryData;
        const service = sms.cli || "Service";

        let maskedNumber = sms.number;
        if (maskedNumber && maskedNumber.length >= 7) {
            const visibleStart = maskedNumber.substring(0, 6);
            const visibleEnd = maskedNumber.substring(maskedNumber.length - 4);
            maskedNumber = `${visibleStart}𝚂𝙼𝚂${visibleEnd}`;
        }

        const finalMsg = `✅ ${flag} <b>${countryName} ${service} Otp Code Received Successfully</b> 🎉

🔑 <b>𝐘𝐨𝐮𝐫 𝐎𝐓𝐏:</b>  <code>${otp}</code>

☎️ <b>Number:</b> <code>${maskedNumber}</code>
⚙️ <b>Service:</b> ${service}
🌍 <b>Country:</b> ${countryName} ${flag}

📩 <b>𝐅𝐮𝐥𝐥-𝐌𝐞𝐬𝐬𝐚𝐠𝐞:</b>
<pre>${sms.message}</pre>`;

        const options = {
            parse_mode: "HTML",
            disable_web_page_preview: true,
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "🚀 Panel", url: this.config.GROUP_LINKS.NUMBER_PANEL_LINK },
                        { text: "📞All Number", url: this.config.GROUP_LINKS.MAIN_CHANNEL_LINK }
                    ]
                ]
            }
        };

        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                await this.queueMessage(() => 
                    this.botGroup.sendMessage(this.config.GROUP_LINKS.OTP_GROUP_ID, finalMsg, options)
                );
                this.emit('sms', `✅ Group message sent: ${otp}`);
                return;
            } catch (e) {
                if (attempt === retries) {
                    this.emit('error', `Group send failed after ${retries} attempts: ${e.message}`);
                } else {
                    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
                    this.emit('log', `⚠️ Retry ${attempt}/${retries} in ${delay}ms: ${e.message}`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
    }

    async sendToUser(sms, retries = 3) {
        if (!sms.number || !sms.message) return;
        const otp = this.extractOtp(sms.message);
        const cleanNumber = String(sms.number).replace(/\D/g, "");

        try {
            const record = await this.NumberModel.findOne({
                number: { $regex: new RegExp(cleanNumber + "$") },
                status: 'Used',
                assigned_to: { $ne: null }
            });

            if (record && record.assigned_to) {
                const userId = record.assigned_to;
                const dbCountryName = record.country;
                const flag = record.flag || sms.countryData.flag;

                let finalOtpPart = "";
                if (otp) {
                    finalOtpPart = `🔑 OTP : <code>${otp}</code>`;
                }

                const finalMsg = `🌎 Country : ${dbCountryName} ${flag}
🔢 Number : <code>${cleanNumber}</code>
${finalOtpPart}

✅ Stay With Us.💖`;

                for (let attempt = 1; attempt <= retries; attempt++) {
                    try {
                        await this.queueMessage(() =>
                            this.botUser.sendMessage(userId, finalMsg, { parse_mode: "HTML" })
                        );
                        this.emit('sms', `✅ Private OTP sent to User: ${userId}`);
                        return;
                    } catch (e) {
                        if (attempt === retries) {
                            this.emit('error', `User send failed after ${retries} attempts: ${e.message}`);
                        } else {
                            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
                            await new Promise(resolve => setTimeout(resolve, delay));
                        }
                    }
                }
            }
        } catch (e) {
            this.emit('error', `User send database error: ${e.message}`);
        }
    }

    async performLogin(user) {
        user.currentUA = this.getRandomUA();
        try {
            this.emit('log', `🔐 Logging in [${user.username}]...`);

            const getRes = await user.client.get(this.LOGIN_PAGE_URL, {
                headers: { "User-Agent": user.currentUA, "Host": this.BASE_DOMAIN }
            });
            const $ = cheerio.load(String(getRes.data || ""));

            let captchaAnswer = null;
            const bodyText = $("body").text();
            const qMatch = bodyText.match(/What is\s*([\-]?\d+)\s*([\+\-\*xX\/])\s*([\-]?\d+)/i);
            if (qMatch) {
                const a = Number(qMatch[1]), op = qMatch[2], b = Number(qMatch[3]);
                switch (op) {
                    case "+": captchaAnswer = String(a + b); break;
                    case "-": captchaAnswer = String(a - b); break;
                    case "*": case "x": case "X": captchaAnswer = String(a * b); break;
                    case "/": captchaAnswer = b !== 0 ? String(Math.floor(a / b)) : "0"; break;
                }
                this.emit('log', `🧮 Captcha solved [${user.username}]: ${captchaAnswer}`);
            }

            const formParams = new URLSearchParams();
            formParams.append("username", user.username);
            formParams.append("password", user.password);
            if (captchaAnswer !== null) formParams.append("capt", captchaAnswer);

            $("form input[type=hidden]").each((i, el) => {
                const name = $(el).attr("name");
                const val = $(el).attr("value") || "";
                if (name && !["username", "password", "capt"].includes(name)) {
                    formParams.append(name, val);
                }
            });

            const postRes = await user.client.post(this.LOGIN_POST_URL, formParams.toString(), {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Referer": this.LOGIN_PAGE_URL,
                    "User-Agent": user.currentUA,
                    "Origin": this.BASE_URL,
                    "Upgrade-Insecure-Requests": "1"
                },
                maxRedirects: 0,
                validateStatus: s => s >= 200 && s < 400,
            });

            if (postRes.status === 302 || postRes.status === 200) {
                this.emit('log', `✅ Login successful [${user.username}]`);
                return true;
            }
            return false;
        } catch (err) {
            this.emit('error', `Login error [${user.username}]: ${err.message}`);
            return false;
        }
    }

    async fetchSmsApi(user) {
        try {
            const res = await user.client.get(this.getApiUrl(), {
                headers: {
                    "User-Agent": user.currentUA,
                    "X-Requested-With": "XMLHttpRequest",
                    "Referer": this.DASHBOARD_URL,
                    "Host": this.BASE_DOMAIN
                },
            });
            return res.data;
        } catch (e) {
            throw new Error(`API error: ${e.message}`);
        }
    }

    async loop(user) {
        try {
            const data = await this.fetchSmsApi(user);

            if (data && Array.isArray(data.aaData) && data.aaData.length > 0) {
                const latest = this.mapRow(data.aaData[0]);

                if (user.lastId === null) {
                    user.lastId = latest.id;
                    this.emit('log', `🚀 Startup [${user.username}]: Sending last message...`);
                    await this.sendToGroup(latest);
                    await this.sendToUser(latest);

                } else if (latest.id !== user.lastId) {
                    user.lastId = latest.id;
                    this.emit('sms', `🔥 New SMS [${user.username}]: ${latest.displayId}`);
                    await this.sendToGroup(latest);
                    await this.sendToUser(latest);
                } else {
                    process.stdout.write(".");
                }

                setTimeout(() => this.loop(user), 3000);
            } else {
                process.stdout.write("x");
                setTimeout(() => this.loop(user), 3000);
            }
        } catch (e) {
            this.emit('error', `Connection error [${user.username}]: ${e.message}`);
            await new Promise(resolve => setTimeout(resolve, 5000));

            const loggedIn = await this.performLogin(user);
            if (loggedIn) {
                this.emit('log', `✅ Re-login success [${user.username}]`);
                this.loop(user);
            } else {
                this.emit('error', `❌ Re-login failed [${user.username}]`);
                setTimeout(() => this.loop(user), 10000);
            }
        }
    }

    async startUser(user) {
        user.currentUA = this.getRandomUA();
        user.jar = new tough.CookieJar();
        user.client = wrapper(axios.create({ jar: user.jar, withCredentials: true }));

        const ok = await this.performLogin(user);
        if (!ok) {
            this.emit('error', `Login failed [${user.username}], retrying in 10s...`);
            setTimeout(() => this.startUser(user), 10000);
            return;
        }
        this.loop(user);
    }

    async start() {
        this.emit('log', '🚀 Multi-User Worker 2 Starting...');
        await this.updateUserAgents();

        for (const user of this.users) {
            this.emit('log', `🚀 Starting user: ${user.username}`);
            this.startUser(user);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

module.exports = OtpWorker2;