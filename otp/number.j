/**
 * SMART AUTO-LOGIN OTP WORKER - Client Panel Monitoring
 * Server: 51.89.99.105
 * Path: /NumberPanel/client/
 * 
 * Features:
 * - Session-aware: Only logs in when session expires
 * - Network error tolerant: Doesn't re-login on API timeouts
 * - Login cooldown: Max 1 login per minute
 * - Session validation before login
 * - Production-grade error handling
 * - User SMS delivery (NEW)
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

class SmartOtpWorker extends EventEmitter {
    constructor() {
        super();
        this.config = null;
        this.botGroup = null;
        this.botUser = null;
        this.NumberModel = null;

        // User Configuration
        this.users = [
            {
                username: "Rasel5500",
                password: "Rasel5500", 
                lastId: null,
                currentUA: null,
                jar: null,
                client: null,
                sessKey: null,
                
                // Smart Login Control
                isSessionValid: false,
                lastLoginAttempt: 0,
                loginCooldown: 60000, // 1 minute
                consecutiveErrors: 0,
                maxConsecutiveErrors: 5
            }
        ];

        this.GLOBAL_USER_AGENTS = [
            "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
        ];

        // Server Configuration
        this.SERVER_IP = "51.89.99.105";
        this.BASE_URL = `http://${this.SERVER_IP}/NumberPanel`;
        this.LOGIN_PAGE_URL = `${this.BASE_URL}/login`;
        this.LOGIN_POST_URL = `${this.BASE_URL}/signin`;
        this.REPORTS_URL = `${this.BASE_URL}/client/SMSCDRStats`;
        this.API_BASE_URL = `${this.BASE_URL}/client/res/data_smscdr.php`;
        this.DASHBOARD_URL = `${this.BASE_URL}/client/dashboard`;
    }

    setConfig(config) {
        this.config = config;
        this.initializeBots();
        this.initializeDatabase();
    }

    initializeBots() {
        try {
            if (this.config?.BOT_TOKENS?.NOTIFICATION_BOT) {
                this.botGroup = new TelegramBot(this.config.BOT_TOKENS.NOTIFICATION_BOT, { polling: false });
                this.emit('log', '✅ Group Bot initialized successfully');
            } else {
                this.emit('error', '⚠️ Group Bot Token missing in config');
            }

            if (this.config?.BOT_TOKENS?.USER_BOT) {
                this.botUser = new TelegramBot(this.config.BOT_TOKENS.USER_BOT, { polling: false });
                this.emit('log', '✅ User Bot initialized successfully');
            } else {
                this.emit('error', '⚠️ User Bot Token missing in config');
            }
        } catch (e) {
            this.emit('error', `Bot initialization failed: ${e.message}`);
        }
    }

    initializeDatabase() {
        try {
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
        } catch (e) {
            this.emit('error', `Database initialization failed: ${e.message}`);
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

    getApiUrl(sessKey) {
        const today = this.getTodayDate();
        const fdate1 = encodeURIComponent(`${today} 00:00:00`);
        const fdate2 = encodeURIComponent(`${today} 23:59:59`);

        return `${this.API_BASE_URL}?fdate1=${fdate1}&fdate2=${fdate2}&frange=&fnum=&fcli=&fgdate=&fgmonth=&fgrange=&fgnumber=&fgcli=&fg=0&sesskey=${encodeURIComponent(sessKey)}&sEcho=1&iColumns=7&sColumns=%2C%2C%2C%2C%2C%2C&iDisplayStart=0&iDisplayLength=25&mDataProp_0=0&sSearch_0=&bRegex_0=false&bSearchable_0=true&bSortable_0=true&mDataProp_1=1&sSearch_1=&bRegex_1=false&bSearchable_1=true&bSortable_1=true&mDataProp_2=2&sSearch_2=&bRegex_2=false&bSearchable_2=true&bSortable_2=true&mDataProp_3=3&sSearch_3=&bRegex_3=false&bSearchable_3=true&bSortable_3=true&mDataProp_4=4&sSearch_4=&bRegex_4=false&bSearchable_4=true&bSortable_4=true&mDataProp_5=5&sSearch_5=&bRegex_5=false&bSearchable_5=true&bSortable_5=true&mDataProp_6=6&sSearch_6=&bRegex_6=false&bSearchable_6=true&bSortable_6=true&sSearch=&bRegex=false&iSortCol_0=0&sSortDir_0=desc&iSortingCols=1`;
    }

    extractOtp(text) {
        if (!text) return null;

        const hashMatch = text.match(/#\s*(\d{4,8})/);
        if (hashMatch && hashMatch[1]) return hashMatch[1];

        const keywordMatch = text.match(/(?:code|otp|pin|verification|vcode|pw|pass|key)[^0-9]*([\d]{4,8})/i);
        if (keywordMatch && keywordMatch[1]) return keywordMatch[1].replace(/\D/g, "");

        const specificMatch = text.match(/(?:\b|\s)(\d{4,8})(?:\b|\s)/);
        if (specificMatch) return specificMatch[1];

        const dashMatch = text.match(/(\d{3,4}-\d{3,4})/);
        if (dashMatch) return dashMatch[0].replace(/-/g, "");

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
        const rawHtmlMessage = row[msgIndex] ? String(row[msgIndex]) : "";

        let fullMessage = rawHtmlMessage;

        if (rawHtmlMessage.includes('<')) {
            try {
                const $ = cheerio.load(rawHtmlMessage, null, false);
                const titleText = $('span').attr('title') || $('div').attr('title') || $('a').attr('title');
                const bodyText = $.text();

                if (titleText && titleText.length >= bodyText.length) {
                    fullMessage = titleText;
                } else {
                    fullMessage = bodyText;
                }
            } catch (e) {
                fullMessage = rawHtmlMessage.replace(/<[^>]*>?/gm, ' ');
            }
        }

        fullMessage = fullMessage.trim();
        const uniqueHash = `${row[0]}_${rawNumber}_${fullMessage.substring(0, 20)}`;

        return {
            id: uniqueHash,
            displayId: row[0],
            number: rawNumber,
            cli: row[3],
            message: fullMessage, 
            countryData: this.getCountryInfo(rawNumber),
        };
    }

    async sendToGroup(sms) {
        if (!this.botGroup) return; 

        const otp = this.extractOtp(sms.message) || "N/A";
        const { name: countryName, flag } = sms.countryData;
        const service = sms.cli || "Service";

        let maskedNumber = sms.number;
        if (maskedNumber && maskedNumber.length >= 7) {
            const visibleStart = maskedNumber.substring(0, 6);
            const visibleEnd = maskedNumber.substring(maskedNumber.length - 4);
            maskedNumber = `${visibleStart}𝚂𝙼𝚂${visibleEnd}`;
        }

        const safeMessage = sms.message
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

        const finalMsg = `✅ ${flag} <b>${countryName} ${service} Otp Code Received Successfully</b> 🎉

🔑 <b>𝘠𝘰𝘶𝘳 𝘖𝘛𝘗:</b>  <code>${otp}</code>

☎️ <b>Number:</b> <code>${maskedNumber}</code>
⚙️ <b>Service:</b> ${service}
🌍 <b>Country:</b> ${countryName} ${flag}

📩 <b>𝐅𝐮𝐥𝐥-𝐌𝐞𝐬𝐬𝐚𝐠𝐞:</b>
<pre>${safeMessage}</pre>`;

        const options = {
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "🚀 Panel", url: this.config?.GROUP_LINKS?.NUMBER_PANEL_LINK },
                        { text: "Buy IP", url: this.config?.GROUP_LINKS?.MAIN_CHANNEL_LINK }
                    ]
                ]
            }
        };

        try {
            await this.botGroup.sendMessage(this.config.GROUP_LINKS.OTP_GROUP_ID, finalMsg, options);
            this.emit('sms', `✅ Group message sent: ${otp}`);
        } catch (e) {
            this.emit('error', `Group send failed: ${e.message}`);
        }
    }

    /**
     * 👤 SEND OTP TO INDIVIDUAL USER
     * Sends private SMS to assigned user from database
     */
    async sendToUser(sms) {
        if (!this.botUser || !this.NumberModel) return;
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

                await this.botUser.sendMessage(userId, finalMsg, { parse_mode: "HTML" });
                this.emit('sms', `✅ Private OTP sent to User: ${userId}`);
            }
        } catch (e) {
            this.emit('error', `User send failed: ${e.message}`);
        }
    }

    /**
     * 🔍 SMART SESSION VALIDATOR
     * Checks if session is still valid WITHOUT full re-login
     */
    async validateSession(user) {
        try {
            const res = await user.client.get(this.DASHBOARD_URL, {
                headers: { "Host": this.SERVER_IP },
                maxRedirects: 0,
                validateStatus: s => s >= 200 && s < 400,
                timeout: 8000
            });

            // If we get redirected to login page = session expired
            if (res.status === 302) {
                const location = res.headers.location || "";
                if (location.includes("/login")) {
                    this.emit('log', `⚠️ Session expired (302 redirect) [${user.username}]`);
                    return false;
                }
            }

            // Check if response contains login form
            const html = String(res.data || "");
            if (html.includes('name="username"') || html.includes('name="password"')) {
                this.emit('log', `⚠️ Session expired (login form detected) [${user.username}]`);
                return false;
            }

            // Session is valid
            return true;

        } catch (err) {
            // Network errors don't mean session is invalid
            if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
                this.emit('error', `⚠️ Session check timeout (network issue, not session issue)`);
                return true; // Assume session is still valid
            }
            this.emit('error', `Session check error: ${err.message}`);
            return true; // Conservative: assume valid on unknown errors
        }
    }

    /**
     * 🔐 SMART LOGIN WITH COOLDOWN
     * Only logs in if:
     * 1. Session is truly expired (validated)
     * 2. Cooldown period has passed
     */
    async smartLogin(user, reason = "unknown") {
        const now = Date.now();
        
        // Check cooldown
        if (now - user.lastLoginAttempt < user.loginCooldown) {
            const waitTime = Math.ceil((user.loginCooldown - (now - user.lastLoginAttempt)) / 1000);
            this.emit('log', `⏳ Login cooldown active, wait ${waitTime}s [${user.username}]`);
            return false;
        }

        // Validate session before logging in
        this.emit('log', `🔍 Validating session before login [${user.username}]...`);
        const isValid = await this.validateSession(user);
        
        if (isValid) {
            this.emit('log', `✅ Session still valid, login skipped [${user.username}]`);
            user.isSessionValid = true;
            return true;
        }

        // Session is expired, proceed with login
        user.lastLoginAttempt = now;
        this.emit('log', `🔐 Login initiated (Reason: ${reason}) [${user.username}]`);

        return await this.performLogin(user);
    }

    /**
     * 🔓 PERFORM LOGIN
     */
    async performLogin(user) {
        user.currentUA = this.getRandomUA();
        user.client.defaults.headers.common['User-Agent'] = user.currentUA;

        try {
            const getRes = await user.client.get(this.LOGIN_PAGE_URL, {
                headers: { "Host": this.SERVER_IP },
                timeout: 10000
            });

            const $ = cheerio.load(String(getRes.data || ""));
            let captchaAnswer = null;

            const bodyHtml = $("body").html() || "";
            const qMatch = bodyHtml.match(/What is\s*(\d+)\s*([\+\-\*xX\/])\s*(\d+)/i) 
                        || $("body").text().match(/What is\s*(\d+)\s*([\+\-\*xX\/])\s*(\d+)/i);

            if (qMatch) {
                const a = Number(qMatch[1]), op = qMatch[2], b = Number(qMatch[3]);
                switch (op) {
                    case "+": captchaAnswer = String(a + b); break;
                    case "-": captchaAnswer = String(a - b); break;
                    case "*": case "x": case "X": captchaAnswer = String(a * b); break;
                    case "/": captchaAnswer = b !== 0 ? String(Math.floor(a / b)) : "0"; break;
                }
                this.emit('log', `🧮 Captcha solved: ${a} ${op} ${b} = ${captchaAnswer}`);
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
                    "Origin": `http://${this.SERVER_IP}`
                },
                maxRedirects: 0,
                validateStatus: s => s >= 200 && s < 400,
                timeout: 10000
            });

            if (postRes.status === 302 || postRes.status === 200) {
                const hasKey = await this.fetchSessionKey(user);
                if (hasKey) {
                    user.isSessionValid = true;
                    user.consecutiveErrors = 0;
                    this.emit('log', `✅ Login successful [${user.username}]`);
                    return true;
                }
            }

            this.emit('error', `❌ Login failed [${user.username}]`);
            user.isSessionValid = false;
            return false;

        } catch (err) {
            this.emit('error', `Login exception [${user.username}]: ${err.message}`);
            user.isSessionValid = false;
            return false;
        }
    }

    /**
     * 🔑 FETCH SESSION KEY
     */
    async fetchSessionKey(user) {
        try {
            const res = await user.client.get(this.REPORTS_URL, {
                headers: {
                    "Referer": this.DASHBOARD_URL,
                    "Host": this.SERVER_IP
                },
                timeout: 10000
            });

            const html = res.data;
            let key = null;
            
            const scriptMatch = html.match(/var\s+sesskey\s*=\s*['"]([^'"]+)['"]/);
            if (scriptMatch) key = scriptMatch[1];
            
            if (!key) {
                const linkMatch = html.match(/sesskey=([^&"']+)/);
                if (linkMatch) key = linkMatch[1];
            }
            
            if (key) {
                user.sessKey = key;
                this.emit('log', `🔑 Session Key: ${user.sessKey.substring(0, 10)}...`);
                return true;
            }
            
            return false;
        } catch (e) {
            this.emit('error', `Session Key fetch error: ${e.message}`);
            return false;
        }
    }

    /**
     * 📡 FETCH SMS API WITH SMART ERROR HANDLING
     */
    async fetchSmsApi(user) {
        if (!user.sessKey) throw new Error("No Session Key");
        
        try {
            const url = this.getApiUrl(user.sessKey);
            const res = await user.client.get(url, {
                headers: {
                    "X-Requested-With": "XMLHttpRequest",
                    "Referer": this.REPORTS_URL,
                    "Host": this.SERVER_IP
                },
                timeout: 12000
            });

            // Reset error counter on success
            user.consecutiveErrors = 0;
            return res.data;

        } catch (e) {
            // Distinguish between network errors and session errors
            if (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT' || e.code === 'ECONNRESET') {
                throw new Error(`NETWORK_ERROR: ${e.message}`);
            }
            
            if (e.response?.status === 401 || e.response?.status === 403) {
                throw new Error(`SESSION_EXPIRED: ${e.message}`);
            }
            
            throw new Error(`API_ERROR: ${e.message}`);
        }
    }

    /**
     * 🔄 MAIN LOOP WITH INTELLIGENT ERROR RECOVERY
     */
    async loop(user) {
        try {
            const data = await this.fetchSmsApi(user);

            if (data && Array.isArray(data.aaData) && data.aaData.length > 0) {
                const latest = this.mapRow(data.aaData[0]);

                if (user.lastId === null) {
                    user.lastId = latest.id;
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
                
                // Continue loop
                setTimeout(() => this.loop(user), 3000);
            } else {
                process.stdout.write("○");
                setTimeout(() => this.loop(user), 3000);
            }

        } catch (e) {
            const errorType = e.message.split(':')[0];
            
            // NETWORK ERRORS - Don't re-login, just retry
            if (errorType === 'NETWORK_ERROR') {
                this.emit('error', `🌐 Network issue [${user.username}]: ${e.message}`);
                user.consecutiveErrors++;
                
                if (user.consecutiveErrors > user.maxConsecutiveErrors) {
                    this.emit('error', `⚠️ Too many errors, resetting session [${user.username}]`);
                    await this.smartLogin(user, "consecutive_errors");
                }
                
                setTimeout(() => this.loop(user), 5000);
                return;
            }

            // SESSION EXPIRED - Smart re-login
            if (errorType === 'SESSION_EXPIRED') {
                this.emit('error', `🔓 Session expired [${user.username}]`);
                user.isSessionValid = false;
                
                const loggedIn = await this.smartLogin(user, "session_expired");
                if (loggedIn) {
                    setTimeout(() => this.loop(user), 2000);
                } else {
                    setTimeout(() => this.loop(user), 10000);
                }
                return;
            }

            // OTHER API ERRORS - Try smart re-login
            this.emit('error', `⚠️ API Error [${user.username}]: ${e.message}`);
            user.consecutiveErrors++;
            
            if (user.consecutiveErrors > 3) {
                const loggedIn = await this.smartLogin(user, "api_errors");
                if (loggedIn) {
                    setTimeout(() => this.loop(user), 2000);
                } else {
                    setTimeout(() => this.loop(user), 10000);
                }
            } else {
                setTimeout(() => this.loop(user), 5000);
            }
        }
    }

    /**
     * 🚀 START USER
     */
    async startUser(user) {
        user.currentUA = this.getRandomUA();
        user.jar = new tough.CookieJar();
        user.client = wrapper(axios.create({ 
            jar: user.jar, 
            withCredentials: true,
            timeout: 15000
        }));

        // Initial login with smart validation
        const ok = await this.smartLogin(user, "initial_start");
        if (!ok) {
            this.emit('error', `Initial login failed [${user.username}], retrying in 30s...`);
            setTimeout(() => this.startUser(user), 30000);
            return;
        }
        
        this.emit('log', `✅ User started successfully [${user.username}]`);
        this.loop(user);
    }

    /**
     * 🚀 START WORKER
     */
    async start() {
        this.emit('log', '🚀 Smart Auto-Login Worker Starting...');
        this.emit('log', '📋 Features: Session-aware | Network tolerant | Login cooldown | User SMS delivery');
        
        for (const user of this.users) {
            this.emit('log', `👤 Starting user: ${user.username}`);
            this.startUser(user);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

// Export
module.exports = SmartOtpWorker;
