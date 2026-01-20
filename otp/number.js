/**
 * Smart OTP Worker - Client Panel Monitoring (51.89.99.105)
 * Features:
 * - Intelligent session management
 * - Auto-login only when session expires
 * - User + Group message support
 * - Multi-message catch-up
 * - Production-grade error handling
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

class SmartClientPanel extends EventEmitter {
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
                
                // Session management
                isLoggedIn: false,
                sessionValid: false,
                lastLoginAttempt: 0,
                loginInProgress: false,
                consecutiveFailures: 0
            }
        ];

        this.GLOBAL_USER_AGENTS = [
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
            "Mozilla/5.0 (Linux; Android 15; Infinix X6858) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.102 Mobile Safari/537.36"
        ];

        // Server Configuration
        this.SERVER_IP = "51.89.99.105";
        this.BASE_URL = `http://${this.SERVER_IP}/NumberPanel`;
        this.LOGIN_PAGE_URL = `${this.BASE_URL}/login`;
        this.LOGIN_POST_URL = `${this.BASE_URL}/signin`;
        this.REPORTS_URL = `${this.BASE_URL}/client/SMSCDRStats`;
        this.API_BASE_URL = `${this.BASE_URL}/client/res/data_smscdr.php`;

        this.UA_JSON_URL = "https://alifhosson-json-api.vercel.app/data/allua99999B.json";
        
        // Login cooldown: 1 minute
        this.LOGIN_COOLDOWN_MS = 60000;
        
        // Message queue
        this.messageQueue = [];
        this.isProcessingQueue = false;
        this.MIN_MESSAGE_DELAY = 100;
        this.MAX_RETRIES = 3;
        this.RETRY_DELAY = 2000;
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

            if (this.config.BOT_TOKENS && this.config.BOT_TOKENS.NOTIFICATION_BOT) {
                this.botGroup = new TelegramBot(this.config.BOT_TOKENS.NOTIFICATION_BOT, botOptions);
                this.botGroup.deleteWebHook().catch(() => {});
                this.emit('log', '✅ Group Bot initialized');
            }

            if (this.config.BOT_TOKENS && this.config.BOT_TOKENS.USER_BOT) {
                this.botUser = new TelegramBot(this.config.BOT_TOKENS.USER_BOT, botOptions);
                this.botUser.deleteWebHook().catch(() => {});
                this.emit('log', '✅ User Bot initialized');
            }
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
            maxPoolSize: 10,
            minPoolSize: 1,
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

    getApiUrl(sessKey) {
        const today = this.getTodayDate();
        const fdate1 = encodeURIComponent(`${today} 00:00:00`);
        const fdate2 = encodeURIComponent(`${today} 23:59:59`);

        return `${this.API_BASE_URL}?fdate1=${fdate1}&fdate2=${fdate2}&frange=&fnum=&fcli=&fgdate=&fgmonth=&fgrange=&fgnumber=&fgcli=&fg=0&sesskey=${encodeURIComponent(sessKey)}&sEcho=1&iColumns=7&sColumns=%2C%2C%2C%2C%2C%2C&iDisplayStart=0&iDisplayLength=25&mDataProp_0=0&sSearch_0=&bRegex_0=false&bSearchable_0=true&bSortable_0=true&mDataProp_1=1&sSearch_1=&bRegex_1=false&bSearchable_1=true&bSortable_1=true&mDataProp_2=2&sSearch_2=&bRegex_2=false&bSearchable_2=true&bSortable_2=true&mDataProp_3=3&sSearch_3=&bRegex_3=false&bSearchable_3=true&bSortable_3=true&mDataProp_4=4&sSearch_4=&bRegex_4=false&bSearchable_4=true&bSortable_4=true&mDataProp_5=5&sSearch_5=&bRegex_5=false&bSearchable_5=true&bSortable_5=true&mDataProp_6=6&sSearch_6=&bRegex_6=false&bSearchable_6=true&bSortable_6=true&sSearch=&bRegex=false&iSortCol_0=0&sSortDir_0=desc&iSortingCols=1`;
    }

    extractOtp(text) {
        if (!text) return null;

        // Remove HTML tags
        let cleanText = text.replace(/<[^>]*>?/gm, ' ');

        // 1. Hash match (e.g., #92667572)
        const hashMatch = cleanText.match(/#\s*(\d{4,8})/);
        if (hashMatch && hashMatch[1]) return hashMatch[1];

        // 2. Keyword match
        const keywordMatch = cleanText.match(/(?:code|otp|pin|verification|vcode|pw|pass|key)[^0-9]*([\d -]{4,9})/i);
        if (keywordMatch && keywordMatch[1]) return keywordMatch[1].replace(/\D/g, "");

        // 3. Specific pattern
        const specificMatch = cleanText.match(/(?:\b|\s)(\d{3}[-\s]?\d{3})(?:\b|\s)/);
        if (specificMatch && specificMatch[1]) return specificMatch[1].replace(/\D/g, "");

        // 4. Any 4-8 digit number
        const simpleMatch = cleanText.match(/\b(\d{4,8})\b/);
        if (simpleMatch) return simpleMatch[0];

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
        const uniqueHash = `${row[0]}_${rawNumber}_${fullMessage.substring(0, 30)}`;

        return {
            id: uniqueHash,
            displayId: row[0],
            number: rawNumber,
            cli: row[3],
            message: fullMessage, 
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

    async sendTelegramWithRetry(bot, chatId, message, options, retries = 0) {
        try {
            await bot.sendMessage(chatId, message, options);
            return true;
        } catch (error) {
            const errorCode = error.code;
            const errorMessage = error.message;

            if (errorCode === 'ECONNRESET' || errorCode === 'ETIMEDOUT' || errorCode === 'ENOTFOUND') {
                if (retries < this.MAX_RETRIES) {
                    const delay = this.RETRY_DELAY * (retries + 1);
                    this.emit('log', `⚠️ Connection error (${errorCode}), retry ${retries + 1}/${this.MAX_RETRIES} in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    return this.sendTelegramWithRetry(bot, chatId, message, options, retries + 1);
                }
            }

            if (errorMessage.includes('429') || errorMessage.includes('Too Many Requests')) {
                const retryAfter = error.response?.parameters?.retry_after || 5;
                this.emit('log', `⚠️ Rate limited, waiting ${retryAfter}s...`);
                await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                return this.sendTelegramWithRetry(bot, chatId, message, options, retries);
            }

            if (errorMessage.includes('403') || errorMessage.includes('Forbidden')) {
                this.emit('error', `❌ Bot blocked by user/chat: ${chatId}`);
                return false;
            }

            throw error;
        }
    }

    async sendToGroup(sms) {
        if (!this.botGroup) return;

        const otp = this.extractOtp(sms.message) || "N/A";
        const { name: countryName, flag } = sms.countryData;
        const service = sms.cli || "Service";

        let maskedNumber = sms.number;
        if (maskedNumber && maskedNumber.length >= 8) {
            const visibleStart = maskedNumber.substring(0, 4);
            const visibleEnd = maskedNumber.substring(maskedNumber.length - 4);
            maskedNumber = `${visibleStart}𝚂𝙼𝚂${visibleEnd}`;
        }

        const safeMessage = sms.message
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

        const finalMsg = `${flag} <b>${countryName} ${service} Otp Code Received Successfully</b> 🎉

📍 <b>𝗬𝗼𝘂𝗿 𝗢𝗧𝗣:</b>  <code>${otp}</code>

☎️ <b>Number:</b> <code>${maskedNumber}</code>
⚙️ <b>Service:</b> ${service}
🌍 <b>Country:</b> ${countryName} ${flag}

📩 <b>𝗙𝘂𝗹𝗹-𝗠𝗲𝘀𝘀𝗮𝗴𝗲:</b>
<pre>${safeMessage}</pre>`;

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

        try {
            const success = await this.queueMessage(() =>
                this.sendTelegramWithRetry(this.botGroup, this.config.GROUP_LINKS.OTP_GROUP_ID, finalMsg, options)
            );

            if (success) {
                this.emit('sms', `✅ Group message sent: ${otp}`);
            } else {
                this.emit('error', `❌ Failed to send group message after retries`);
            }
        } catch (e) {
            this.emit('error', `Group send failed: ${e.code || 'UNKNOWN'}: ${e.message}`);
        }
    }

    async sendToUser(sms) {
        if (!this.botUser || !sms.number || !sms.message) return;

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
                    finalOtpPart = `📍 OTP : <code>${otp}</code>`;
                }

                const finalMsg = `🌎 Country : ${dbCountryName} ${flag}
📢 Number : <code>${cleanNumber}</code>
${finalOtpPart}

✅ Stay With Us.💖`;

                const success = await this.queueMessage(() =>
                    this.sendTelegramWithRetry(this.botUser, userId, finalMsg, { parse_mode: "HTML" })
                );

                if (success) {
                    this.emit('sms', `✅ Private OTP sent to User: ${userId}`);
                } else {
                    this.emit('error', `❌ Failed to send to user ${userId} after retries`);
                }
            }
        } catch (e) {
            this.emit('error', `User send failed: ${e.code || 'UNKNOWN'}: ${e.message}`);
        }
    }

    /**
     * 🔐 SESSION VALIDATION
     */
    async validateSession(user) {
        try {
            const response = await user.client.get(this.REPORTS_URL, {
                headers: {
                    "User-Agent": user.currentUA,
                    "Host": this.SERVER_IP
                },
                maxRedirects: 0,
                validateStatus: (status) => status >= 200 && status < 400
            });

            const pageContent = String(response.data || "");
            const isLoginPage = pageContent.includes("login") && 
                               (pageContent.includes("username") || pageContent.includes("password"));
            
            if (response.status === 200 && !isLoginPage) {
                // Check if sessKey is still present
                const hasSessionKey = pageContent.includes("sesskey");
                if (hasSessionKey) {
                    user.sessionValid = true;
                    return true;
                }
            }
            
            user.sessionValid = false;
            return false;
            
        } catch (error) {
            if (error.response?.status === 302 || error.response?.status === 401) {
                user.sessionValid = false;
                return false;
            }
            
            this.emit('log', `⚠️ Session check network error [${user.username}]: ${error.message}`);
            return user.sessionValid;
        }
    }

    /**
     * 🔐 SMART LOGIN WITH COOLDOWN
     */
    async performSmartLogin(user) {
        const now = Date.now();
        const timeSinceLastLogin = now - user.lastLoginAttempt;

        if (user.loginInProgress) {
            this.emit('log', `⏳ Login already in progress [${user.username}]`);
            while (user.loginInProgress) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            return user.isLoggedIn;
        }

        if (timeSinceLastLogin < this.LOGIN_COOLDOWN_MS && user.lastLoginAttempt > 0) {
            const waitTime = Math.ceil((this.LOGIN_COOLDOWN_MS - timeSinceLastLogin) / 1000);
            this.emit('log', `⏰ Login cooldown active [${user.username}] - wait ${waitTime}s`);
            return false;
        }

        const sessionValid = await this.validateSession(user);
        if (sessionValid) {
            this.emit('log', `✅ Session still valid [${user.username}] - login not needed`);
            user.isLoggedIn = true;
            return true;
        }

        user.loginInProgress = true;
        user.lastLoginAttempt = now;

        try {
            const success = await this.performLogin(user);
            
            if (success) {
                user.isLoggedIn = true;
                user.sessionValid = true;
                user.consecutiveFailures = 0;
                this.emit('log', `✅ Login successful [${user.username}]`);
            } else {
                user.isLoggedIn = false;
                user.sessionValid = false;
                user.consecutiveFailures++;
                this.emit('error', `❌ Login failed [${user.username}] - attempt ${user.consecutiveFailures}`);
            }
            
            return success;
            
        } finally {
            user.loginInProgress = false;
        }
    }

    /**
     * 🔐 PERFORM LOGIN
     */
    async performLogin(user) {
        user.currentUA = this.getRandomUA();
        user.client.defaults.headers.common['User-Agent'] = user.currentUA;

        try {
            this.emit('log', `🔑 Logging in [${user.username}]...`);

            const getRes = await user.client.get(this.LOGIN_PAGE_URL, {
                headers: { "Host": this.SERVER_IP }
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
                this.emit('log', `🧮 Captcha solved [${user.username}]: ${captchaAnswer}`);
            }

            const formParams = new URLSearchParams();
            formParams.append("username", user.username);
            formParams.append("password", user.password);
            if (captchaAnswer !== null) formParams.append("capt", captchaAnswer);

            $("form input[type=hidden]").each((i, el) => {
                const name = $(el).attr("name");
                const val = $(el).attr("value") || "";
                if (name && !["username", "password", "capt"].includes(name)) formParams.append(name, val);
            });

            const postRes = await user.client.post(this.LOGIN_POST_URL, formParams.toString(), {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Referer": this.LOGIN_PAGE_URL,
                    "Origin": `http://${this.SERVER_IP}`,
                    "Upgrade-Insecure-Requests": "1"
                },
                maxRedirects: 0,
                validateStatus: s => s >= 200 && s < 400,
            });

            if (postRes.status === 302 || postRes.status === 200) {
                return await this.fetchSessionKey(user);
            }
            return false;
        } catch (err) {
            this.emit('error', `Login error [${user.username}]: ${err.message}`);
            return false;
        }
    }

    async fetchSessionKey(user) {
        try {
            const res = await user.client.get(this.REPORTS_URL, {
                headers: {
                    "Referer": this.BASE_URL,
                    "Host": this.SERVER_IP
                }
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
                this.emit('log', `🔑 Session Key: ${user.sessKey}`);
                return true;
            }
            return false;
        } catch (e) {
            this.emit('error', `Session Key fetch error: ${e.message}`);
            return false;
        }
    }

    /**
     * 🔐 SMART API FETCH
     */
    async fetchSmsApi(user) {
        if (!user.sessKey) throw new Error('SESSION_EXPIRED');

        try {
            const url = this.getApiUrl(user.sessKey);
            const res = await user.client.get(url, {
                headers: {
                    "X-Requested-With": "XMLHttpRequest",
                    "Referer": this.REPORTS_URL,
                    "Host": this.SERVER_IP
                },
                timeout: 15000,
                maxRedirects: 0,
                validateStatus: (status) => status >= 200 && status < 400
            });

            if (res.status === 302 || res.status === 301) {
                this.emit('log', `🔒 Redirect detected [${user.username}] - session expired`);
                user.sessionValid = false;
                user.isLoggedIn = false;
                throw new Error('SESSION_EXPIRED');
            }

            const responseData = res.data;

            if (typeof responseData === 'string') {
                const htmlContent = responseData.toLowerCase();
                
                if (htmlContent.includes('<form') && 
                    (htmlContent.includes('username') || htmlContent.includes('password') || htmlContent.includes('login'))) {
                    this.emit('log', `🔒 Login page detected [${user.username}] - session expired`);
                    user.sessionValid = false;
                    user.isLoggedIn = false;
                    throw new Error('SESSION_EXPIRED');
                }
                
                try {
                    const parsed = JSON.parse(responseData);
                    if (parsed && typeof parsed === 'object') {
                        user.sessionValid = true;
                        user.isLoggedIn = true;
                        user.consecutiveFailures = 0;
                        return parsed;
                    }
                } catch (e) {
                    this.emit('log', `⚠️ Non-JSON response [${user.username}]`);
                    throw new Error('INVALID_RESPONSE');
                }
            }

            if (responseData && typeof responseData === 'object') {
                if (responseData.error || responseData.message) {
                    const errorMsg = error.message;
            if (errorMsg === 'SESSION_EXPIRED' || errorMsg === 'INVALID_RESPONSE' || 
                errorMsg === 'NETWORK_ERROR' || errorMsg === 'SERVER_ERROR') {
                throw error;
            }

            this.emit('log', `⚠️ Unknown fetch error [${user.username}]: ${errorMsg}`);
            throw new Error('UNKNOWN_ERROR');
        }
    }

    /**
     * 🔄 MAIN MONITORING LOOP
     */
    async loop(user) {
        try {
            const data = await this.fetchSmsApi(user);

            if (data && Array.isArray(data.aaData) && data.aaData.length > 0) {
                // Process ALL new messages
                const currentMessages = data.aaData.map(row => this.mapRow(row));
                
                if (user.lastId === null) {
                    const latest = currentMessages[0];
                    user.lastId = latest.id;
                    await this.sendToGroup(latest);
                    await this.sendToUser(latest);
                } else {
                    const newMessages = [];
                    for (const msg of currentMessages) {
                        if (msg.id !== user.lastId) {
                            newMessages.push(msg);
                        } else {
                            break;
                        }
                    }
                    
                    if (newMessages.length > 0) {
                        for (const newMsg of newMessages) {
                            this.emit('sms', `🔥 New SMS [${user.username}]: ${newMsg.displayId}`);
                            await this.sendToGroup(newMsg);
                            await this.sendToUser(newMsg);
                        }
                        
                        user.lastId = newMessages[0].id;
                        
                        if (newMessages.length > 1) {
                            this.emit('log', `📬 Sent ${newMessages.length} queued messages [${user.username}]`);
                        }
                    } else {
                        process.stdout.write(".");
                    }
                }
                
                setTimeout(() => this.loop(user), 3000);
                
            } else if (data && typeof data === 'object') {
                process.stdout.write("x");
                setTimeout(() => this.loop(user), 3000);
            } else {
                this.emit('log', `⚠️ Unexpected data format [${user.username}]`);
                setTimeout(() => this.loop(user), 5000);
            }

        } catch (error) {
            const errorMsg = error.message;
            
            if (errorMsg === 'SESSION_EXPIRED') {
                this.emit('log', `🔐 Session expired detected [${user.username}] - attempting auto-login`);
                
                const loginSuccess = await this.performSmartLogin(user);
                
                if (loginSuccess) {
                    this.emit('log', `✅ Auto-login successful [${user.username}] - resuming monitoring`);
                    setTimeout(() => this.loop(user), 2000);
                } else {
                    this.emit('error', `❌ Auto-login failed [${user.username}] - retry in 30s`);
                    setTimeout(() => this.loop(user), 30000);
                }
                return;
            }
            
            if (errorMsg === 'NETWORK_ERROR') {
                user.consecutiveFailures++;
                this.emit('log', `⚠️ Network issue [${user.username}] (${user.consecutiveFailures}) - retry in 10s`);
                setTimeout(() => this.loop(user), 10000);
                return;
            }
            
            if (errorMsg === 'SERVER_ERROR') {
                user.consecutiveFailures++;
                this.emit('log', `⚠️ Server error [${user.username}] (${user.consecutiveFailures}) - retry in 15s`);
                setTimeout(() => this.loop(user), 15000);
                return;
            }
            
            if (errorMsg === 'INVALID_RESPONSE') {
                user.consecutiveFailures++;
                this.emit('log', `⚠️ Invalid response [${user.username}] (${user.consecutiveFailures})`);
                
                if (user.consecutiveFailures >= 3) {
                    this.emit('log', `🔄 Multiple invalid responses [${user.username}] - attempting re-login`);
                    user.consecutiveFailures = 0;
                    const loginSuccess = await this.performSmartLogin(user);
                    
                    if (loginSuccess) {
                        setTimeout(() => this.loop(user), 2000);
                    } else {
                        setTimeout(() => this.loop(user), 30000);
                    }
                } else {
                    setTimeout(() => this.loop(user), 8000);
                }
                return;
            }
            
            user.consecutiveFailures++;
            this.emit('error', `❌ Unknown error [${user.username}]: ${errorMsg} (failure ${user.consecutiveFailures})`);
            
            if (user.consecutiveFailures >= 5) {
                this.emit('log', `🔄 Too many failures [${user.username}] - attempting re-login`);
                user.consecutiveFailures = 0;
                await this.performSmartLogin(user);
                setTimeout(() => this.loop(user), 5000);
            } else {
                setTimeout(() => this.loop(user), 12000);
            }
        }
    }

    /**
     * 🚀 START USER MONITORING
     */
    async startUser(user) {
        user.currentUA = this.getRandomUA();
        user.jar = new tough.CookieJar();
        user.client = wrapper(axios.create({ 
            jar: user.jar, 
            withCredentials: true,
            timeout: 15000
        }));

        this.emit('log', `🚀 Starting user [${user.username}]...`);
        
        const loginSuccess = await this.performSmartLogin(user);
        
        if (!loginSuccess) {
            this.emit('error', `❌ Initial login failed [${user.username}] - retry in 30s`);
            setTimeout(() => this.startUser(user), 30000);
            return;
        }
        
        this.emit('log', `✅ User ready [${user.username}] - starting monitoring loop`);
        this.loop(user);
    }

    /**
     * 🚀 START ALL USERS
     */
    async start() {
        this.emit('log', '🚀 Smart Client Panel Worker Starting (51.89.99.105)...');
        this.emit('log', '📋 Features:');
        this.emit('log', '   ✓ Smart auto-login (only when needed)');
        this.emit('log', '   ✓ Session validation before login');
        this.emit('log', '   ✓ Login cooldown protection');
        this.emit('log', '   ✓ Multi-message catch-up');
        this.emit('log', '   ✓ User + Group notifications');
        this.emit('log', '');
        
        await this.updateUserAgents();

        for (const user of this.users) {
            this.emit('log', `🚀 Starting: ${user.username}`);
            this.startUser(user);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        this.emit('log', `✅ All ${this.users.length} users started successfully`);
    }
}

module.exports = SmartClientPanel; responseData.error || responseData.message;
                    if (typeof errorMsg === 'string' && 
                        (errorMsg.toLowerCase().includes('login') || 
                         errorMsg.toLowerCase().includes('session') ||
                         errorMsg.toLowerCase().includes('unauthorized'))) {
                        this.emit('log', `🔒 API error indicates session expired [${user.username}]`);
                        user.sessionValid = false;
                        user.isLoggedIn = false;
                        throw new Error('SESSION_EXPIRED');
                    }
                }
                
                user.sessionValid = true;
                user.isLoggedIn = true;
                user.consecutiveFailures = 0;
                return responseData;
            }

            this.emit('log', `⚠️ Unexpected response type [${user.username}]: ${typeof responseData}`);
            throw new Error('INVALID_RESPONSE');

        } catch (error) {
            if (error.response) {
                const statusCode = error.response.status;
                
                if (statusCode === 302 || statusCode === 301 || statusCode === 401 || statusCode === 403) {
                    this.emit('log', `🔒 HTTP ${statusCode} [${user.username}] - session expired`);
                    user.sessionValid = false;
                    user.isLoggedIn = false;
                    throw new Error('SESSION_EXPIRED');
                }
                
                if (statusCode >= 500) {
                    this.emit('log', `⚠️ Server error ${statusCode} [${user.username}]`);
                    throw new Error('SERVER_ERROR');
                }
            }

            const errorCode = error.code;
            if (errorCode === 'ETIMEDOUT' || errorCode === 'ECONNRESET' || 
                errorCode === 'ENOTFOUND' || errorCode === 'ECONNREFUSED' ||
                errorCode === 'EHOSTUNREACH') {
                this.emit('log', `⚠️ Network error [${user.username}]: ${errorCode}`);
                throw new Error('NETWORK_ERROR');
            }

            const errorMsg =
