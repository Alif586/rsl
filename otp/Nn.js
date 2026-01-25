/**
 * OTP WORKER - Client Panel Monitoring (Fixed for Client URL)
 * Server: 51.89.99.105
 * Path: /NumberPanel/client/
 */

const axios = require("axios").default;
const tough = require("tough-cookie");
const { wrapper } = require("axios-cookiejar-support");
const cheerio = require("cheerio");
const TelegramBot = require("node-telegram-bot-api");
const { parsePhoneNumberFromString } = require("libphonenumber-js");
const countryEmoji = require("country-emoji");
const EventEmitter = require("events");

class OtpWorkerClient extends EventEmitter {
    constructor() {
        super();
        this.config = null;
        this.botGroup = null;

        // User Configuration
        this.users = [
            {
                username: "Rasel5500",
                password: "Rasel5500", 
                lastId: null,
                currentUA: null,
                jar: null,
                client: null,
                sessKey: null
            }
        ];

        this.GLOBAL_USER_AGENTS = [
            "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
        ];

        // Server Configuration (UPDATED FOR CLIENT PANEL)
        this.SERVER_IP = "51.89.99.105";
        this.BASE_URL = `http://${this.SERVER_IP}/NumberPanel`;
        this.LOGIN_PAGE_URL = `${this.BASE_URL}/login`;
        this.LOGIN_POST_URL = `${this.BASE_URL}/signin`;

        // Changed from 'agent' to 'client' based on your CURL
        this.REPORTS_URL = `${this.BASE_URL}/client/SMSCDRStats`; 
        this.API_BASE_URL = `${this.BASE_URL}/client/res/data_smscdr.php`;

        this.UA_JSON_URL = "https://alifhosson-json-api.vercel.app/data/allua99999B.json";
    }

    setConfig(config) {
        this.config = config;
        this.initializeBots();
    }

    initializeBots() {
        try {
            if (this.config.BOT_TOKENS && this.config.BOT_TOKENS.NOTIFICATION_BOT) {
                this.botGroup = new TelegramBot(this.config.BOT_TOKENS.NOTIFICATION_BOT, { polling: false });
                this.emit('log', '✅ Bot initialized successfully');
            } else {
                this.emit('error', '⚠️ Bot Token missing in config');
            }
        } catch (e) {
            this.emit('error', `Bot initialization failed: ${e.message}`);
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

    // --- UPDATED API URL GENERATOR BASED ON YOUR CURL ---
    getApiUrl(sessKey) {
        const today = this.getTodayDate();
        // URL Encoding fixed to match curl
        const fdate1 = encodeURIComponent(`${today} 00:00:00`);
        const fdate2 = encodeURIComponent(`${today} 23:59:59`);

        // Params from your curl command
        // Note: Added iSortCol_0=0 & sSortDir_0=desc to ensure latest SMS is first
        return `${this.API_BASE_URL}?fdate1=${fdate1}&fdate2=${fdate2}&frange=&fnum=&fcli=&fgdate=&fgmonth=&fgrange=&fgnumber=&fgcli=&fg=0&sesskey=${encodeURIComponent(sessKey)}&sEcho=1&iColumns=7&sColumns=%2C%2C%2C%2C%2C%2C&iDisplayStart=0&iDisplayLength=25&mDataProp_0=0&sSearch_0=&bRegex_0=false&bSearchable_0=true&bSortable_0=true&mDataProp_1=1&sSearch_1=&bRegex_1=false&bSearchable_1=true&bSortable_1=true&mDataProp_2=2&sSearch_2=&bRegex_2=false&bSearchable_2=true&bSortable_2=true&mDataProp_3=3&sSearch_3=&bRegex_3=false&bSearchable_3=true&bSortable_3=true&mDataProp_4=4&sSearch_4=&bRegex_4=false&bSearchable_4=true&bSortable_4=true&mDataProp_5=5&sSearch_5=&bRegex_5=false&bSearchable_5=true&bSortable_5=true&mDataProp_6=6&sSearch_6=&bRegex_6=false&bSearchable_6=true&bSortable_6=true&sSearch=&bRegex=false&iSortCol_0=0&sSortDir_0=desc&iSortingCols=1`;
    }

    extractOtp(text) {
        if (!text) return null;

        // 1. Hash match (e.g., #92667572)
        const hashMatch = text.match(/#\s*(\d{4,8})/);
        if (hashMatch && hashMatch[1]) return hashMatch[1];

        // 2. Keyword match
        const keywordMatch = text.match(/(?:code|otp|pin|verification|vcode|pw|pass|key)[^0-9]*([\d]{4,8})/i);
        if (keywordMatch && keywordMatch[1]) return keywordMatch[1].replace(/\D/g, "");

        // 3. Any 4-8 digit number
        const specificMatch = text.match(/(?:\b|\s)(\d{4,8})(?:\b|\s)/);
        if (specificMatch) return specificMatch[1];

        // 4. Dash code
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
        // In Client panel, column indices might slightly differ, usually:
        // 0: Time, 1: ?, 2: Number, 3: Service, 4: Message
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
                        { text: "🚀 Panel", url: this.config.GROUP_LINKS.NUMBER_PANEL_LINK || "https://t.me/" },
                        { text: "Buy IP", url: this.config.GROUP_LINKS.MAIN_CHANNEL_LINK || "https://t.me/" }
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

    async performLogin(user) {
        user.currentUA = this.getRandomUA();
        user.client.defaults.headers.common['User-Agent'] = user.currentUA;

        try {
            this.emit('log', `🔐 Logging in [${user.username}]...`);

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
                this.emit('log', `🧮 Captcha solved: ${a} ${op} ${b} = ${captchaAnswer}`);
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
                    "Origin": `http://${this.SERVER_IP}`
                },
                maxRedirects: 0,
                validateStatus: s => s >= 200 && s < 400,
            });

            if (postRes.status === 302) {
                this.emit('log', `✅ Login Redirect (302) [${user.username}]`);
                return await this.fetchSessionKey(user);
            } 
            else if (postRes.status === 200) {
                const hasKey = await this.fetchSessionKey(user);
                if(hasKey) return true;
                this.emit('error', `❌ Login returned 200 but no session key`);
                return false;
            }
            return false;
        } catch (err) {
            this.emit('error', `Login exception [${user.username}]: ${err.message}`);
            return false;
        }
    }

    async fetchSessionKey(user) {
        try {
            // Updated to use the Client Reports URL
            const res = await user.client.get(this.REPORTS_URL, {
                headers: {
                    "Referer": this.DASHBOARD_URL, // Or generic dashboard
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
                this.emit('log', `🔑 Session Key found: ${user.sessKey}`);
                return true;
            }
            return false;
        } catch (e) {
            this.emit('error', `Session Key fetch error: ${e.message}`);
            return false;
        }
    }

    async fetchSmsApi(user) {
        if (!user.sessKey) throw new Error("No Session Key available");
        try {
            const url = this.getApiUrl(user.sessKey);
            const res = await user.client.get(url, {
                headers: {
                    "X-Requested-With": "XMLHttpRequest",
                    "Referer": this.REPORTS_URL, // Updated Referer
                    "Host": this.SERVER_IP
                },
            });
            return res.data;
        } catch (e) {
            throw new Error(`Fetch error: ${e.message}`);
        }
    }

    async loop(user) {
        try {
            const data = await this.fetchSmsApi(user);

            if (data && Array.isArray(data.aaData) && data.aaData.length > 0) {
                const latest = this.mapRow(data.aaData[0]);

                if (user.lastId === null) {
                    user.lastId = latest.id;
                    await this.sendToGroup(latest);
                } else if (latest.id !== user.lastId) {
                    user.lastId = latest.id;
                    this.emit('sms', `🔥 New SMS [${user.username}]: ${latest.displayId}`);
                    await this.sendToGroup(latest);
                } else {
                    process.stdout.write(".");
                }
                setTimeout(() => this.loop(user), 3000);
            } else {
                process.stdout.write("x");
                setTimeout(() => this.loop(user), 3000);
            }

        } catch (e) {
            this.emit('error', `Loop Error [${user.username}]: ${e.message}`);
            await new Promise(resolve => setTimeout(resolve, 5000));
            const loggedIn = await this.performLogin(user);
            if (loggedIn) this.loop(user);
            else setTimeout(() => this.loop(user), 10000);
        }
    }

    async startUser(user) {
        user.currentUA = this.getRandomUA();
        user.jar = new tough.CookieJar();
        user.client = wrapper(axios.create({ jar: user.jar, withCredentials: true }));

        const ok = await this.performLogin(user);
        if (!ok) {
            this.emit('error', `Initial login failed [${user.username}], retrying in 10s...`);
            setTimeout(() => this.startUser(user), 10000);
            return;
        }
        this.loop(user);
    }

    async start() {
        this.emit('log', '🚀 Client Panel Worker Starting (51.89.99.105/client/)...');
        for (const user of this.users) {
            this.emit('log', `🚀 Starting user: ${user.username}`);
            this.startUser(user);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

module.exports = OtpWorkerClient;