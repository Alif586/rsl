/**
 * OTP WORKER 1 - SMS Panel Monitoring (Multi-User)
 * Server: 51.89.99.105 (NumberPanel)
 * Status: Fixed (Headers synced with cURL, Crash removed)
 */

const axios = require("axios").default;
const tough = require("tough-cookie");
const { wrapper } = require("axios-cookiejar-support");
const cheerio = require("cheerio");
const TelegramBot = require("node-telegram-bot-api");
const { parsePhoneNumberFromString } = require("libphonenumber-js");
const countryEmoji = require("country-emoji");
const EventEmitter = require("events");

class OtpWorker1 extends EventEmitter {
    constructor() {
        super();
        this.config = null;
        this.botGroup = null;

        this.users = [
            {
                username: "Rasel6669",
                password: "Rasel6669",
                lastId: null,
                currentUA: null,
                jar: null,
                client: null
            }
        ];

        // Specific UA from your successful cURL
        this.ANDROID_UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";
        
        this.SERVER_IP = "51.89.99.105";
        this.BASE_URL = `http://${this.SERVER_IP}/NumberPanel`; 
        
        this.LOGIN_PAGE_URL = `${this.BASE_URL}/login`;
        this.LOGIN_POST_URL = `${this.BASE_URL}/signin`;
        this.CLIENT_HOME_URL = `${this.BASE_URL}/client/`; // Added from cURL flow
        this.DASHBOARD_URL = `${this.BASE_URL}/client/SMSCDRStats`;
        this.API_BASE_URL = `${this.BASE_URL}/client/res/data_smscdr.php`;

        this.UA_JSON_URL = "https://alifhosson-json-api.vercel.app/data/allua99999B.json";
    }

    setConfig(config) {
        this.config = config;
        this.initializeBots();
    }

    initializeBots() {
        try {
            this.botGroup = new TelegramBot(this.config.BOT_TOKENS.NOTIFICATION_BOT, { polling: false });
            this.emit('log', '✅ Bot initialized successfully');
        } catch (e) {
            this.emit('error', `Bot initialization failed: ${e.message}`);
        }
    }

    // Standard headers from your cURL to prevent 503
    getCommonHeaders(referer = null) {
        const headers = {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'Accept-Language': 'en-US,en;q=0.9,fr-FR;q=0.8,fr;q=0.7,sq-AL;q=0.6,sq;q=0.5,pt-PT;q=0.4,pt;q=0.3,az-AZ;q=0.2,az;q=0.1',
            'Cache-Control': 'max-age=0',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'User-Agent': this.ANDROID_UA,
            'Host': this.SERVER_IP
        };
        if (referer) headers['Referer'] = referer;
        return headers;
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
        let cleanText = text.replace(/<[^>]*>?/gm, ' ');
        const keywordMatch = cleanText.match(/(?:code|otp|pin|verification|vcode|pw|pass)[^0-9]*([\d -]{4,9})/i);
        if (keywordMatch && keywordMatch[1]) return keywordMatch[1].replace(/\D/g, "");
        const specificMatch = cleanText.match(/(?:\b|\s)(\d{3}[-\s]?\d{3})(?:\b|\s)/);
        if (specificMatch && specificMatch[1]) return specificMatch[1].replace(/\D/g, "");
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

    async sendToGroup(sms) {
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

🔑 <b>𝘠𝘰𝘶𝘳 𝘖𝘛𝘗:</b>  <code>${otp}</code>

☎️ <b>Number:</b> <code>${maskedNumber}</code>
⚙️ <b>Service:</b> ${service}
🌍 <b>Country:</b> ${countryName} ${flag}

📩 <b>𝐅𝐮𝐥𝐥-𝐌𝐞𝐬𝐬𝐚𝐠𝐞:</b>
<pre>${sms.message}</pre>`;

        const options = {
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "🚀 Panel", url: this.config.GROUP_LINKS.NUMBER_PANEL_LINK },
                        { text: "Buy IP", url: this.config.GROUP_LINKS.MAIN_CHANNEL_LINK }
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
        try {
            this.emit('log', `🔐 Logging in [${user.username}]...`);

            // 1. GET Login Page (Set Cookies)
            // Use standard UA to get the captcha properly
            const headersGet = this.getCommonHeaders();
            const getRes = await user.client.get(this.LOGIN_PAGE_URL, { headers: headersGet });
            
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
                if (name && !["username", "password", "capt"].includes(name)) formParams.append(name, val);
            });

            // 2. POST Login Data (Matches your cURL exactly)
            const headersPost = {
                ...this.getCommonHeaders(this.LOGIN_PAGE_URL),
                "Content-Type": "application/x-www-form-urlencoded",
                "Origin": `http://${this.SERVER_IP}`
            };

            const postRes = await user.client.post(this.LOGIN_POST_URL, formParams.toString(), {
                headers: headersPost,
                maxRedirects: 0,
                validateStatus: s => s >= 200 && s < 400,
            });

            if (postRes.status === 302 || postRes.status === 200) {
                this.emit('log', `✅ Login successful [${user.username}]`);
                
                // 3. Follow up GET to /client/ (As seen in your cURL)
                // This mimics the redirect behavior of the browser
                try {
                    await user.client.get(this.CLIENT_HOME_URL, {
                        headers: this.getCommonHeaders(this.LOGIN_PAGE_URL)
                    });
                } catch(e) { /* Ignore minor error on redirect check */ }

                return true;
            }
            return false;
        } catch (err) {
            if (err.response && err.response.status === 503) {
                this.emit('error', `Login 503 [${user.username}] - Server Busy`);
            } else {
                this.emit('error', `Login error [${user.username}]: ${err.message}`);
            }
            return false;
        }
    }

    async fetchSmsApi(user) {
        try {
            // API Headers: mimic standard browser AJAX + Referer
            const headers = {
                ...this.getCommonHeaders(this.DASHBOARD_URL),
                "X-Requested-With": "XMLHttpRequest",
                "Accept": "application/json, text/javascript, */*; q=0.01",
            };

            const res = await user.client.get(this.getApiUrl(), {
                headers: headers,
                timeout: 10000 
            });
            return res.data;
        } catch (e) {
            if (e.response && e.response.status === 503) {
                throw new Error("503 Service Unavailable");
            }
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
            const is503 = e.message.includes("503");
            this.emit('error', `Connection error [${user.username}]: ${e.message}`);
            
            const waitTime = is503 ? 15000 : 5000;
            if(is503) this.emit('log', `⚠️ Pausing for 15s due to 503...`);

            await new Promise(resolve => setTimeout(resolve, waitTime));

            // Try to re-login
            const loggedIn = await this.performLogin(user);
            if (loggedIn) {
                this.emit('log', `✅ Re-login success [${user.username}]`);
                this.loop(user);
            } else {
                setTimeout(() => this.loop(user), 10000);
            }
        }
    }

    async startUser(user) {
        user.jar = new tough.CookieJar();
        // Removed custom httpAgent to fix the crash
        user.client = wrapper(axios.create({ 
            jar: user.jar, 
            withCredentials: true,
            timeout: 15000
        }));

        const ok = await this.performLogin(user);
        if (!ok) {
            this.emit('error', `Login failed [${user.username}], retrying in 10s...`);
            setTimeout(() => this.startUser(user), 10000);
            return;
        }
        this.loop(user);
    }

    async start() {
        this.emit('log', '🚀 Multi-User Worker Starting...');
        
        for (const user of this.users) {
            this.emit('log', `🚀 Starting user: ${user.username}`);
            this.startUser(user);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

module.exports = OtpWorker1;
