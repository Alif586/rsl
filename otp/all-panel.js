/**
 * UNIVERSAL OTP WORKER - Ultimate Stability Version (With Pro Headers)
 * Features: DB Crash Protection, Socket Hang-up Fix, Smart Cookie Merging, Real Browser Headers
 */

const axios = require("axios").default;
const cheerio = require("cheerio");
const TelegramBot = require("node-telegram-bot-api");
const { parsePhoneNumberFromString } = require("libphonenumber-js");
const countryEmoji = require("country-emoji");
const mongoose = require("mongoose");
const EventEmitter = require("events");
const fs = require("fs");
const path = require("path");
const http = require('http');
const https = require('https');

// ✅ High Performance Agents (Tuned for stability)
const httpAgent = new http.Agent({ 
    keepAlive: true, 
    maxSockets: 70, 
    keepAliveMsecs: 30000,
    timeout: 60000 
});

const httpsAgent = new https.Agent({ 
    keepAlive: true, 
    maxSockets: 50, 
    keepAliveMsecs: 30000,
    timeout: 60000
});

class Russel extends EventEmitter {
    constructor() {
        super();
        this.config = null;
        this.botGroup = null;
        this.botUser = null;
        this.NumberModel = null;
        this.servers = [];
        this.allUsers = [];
        this.dbConnected = false;
    }

    loadServersConfig() {
        try {
            const configPath = path.join(__dirname, 'pass.json');
            if (!fs.existsSync(configPath)) {
                throw new Error("pass.json file not found!");
            }
            const configData = fs.readFileSync(configPath, 'utf8');
            const serversConfig = JSON.parse(configData);

            this.servers = serversConfig.servers.filter(s => s.enabled);
            
            this.servers.forEach(server => {
                server.users.forEach(user => {
                    this.allUsers.push({
                        serverName: server.name,
                        serverIp: server.server_ip,
                        protocol: server.protocol,
                        basePath: server.base_path,
                        username: user.username,
                        password: user.password,
                        serverLabel: user.server_label || server.name,
                        lastId: null,
                        currentUA: null,
                        client: null,
                        cookies: "" 
                    });
                });
            });

            this.emit('log', `✅ Loaded ${this.servers.length} servers with ${this.allUsers.length} total users`);
            return true;
        } catch (error) {
            this.emit('error', `Failed to load pass.json: ${error.message}`);
            return false;
        }
    }

    setConfig(config) {
        this.config = config;
        this.initializeBots();
        this.initializeDatabase();
    }

    initializeBots() {
        try {
            this.botGroup = new TelegramBot(this.config.BOT_TOKENS.NOTIFICATION_BOT, { polling: false });
            this.botGroup.on('error', (e) => this.emit('error', `Bot Group Error: ${e.message}`));

            this.botUser = new TelegramBot(this.config.BOT_TOKENS.USER_BOT, { polling: false });
            this.botUser.on('error', (e) => this.emit('error', `Bot User Error: ${e.message}`));

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
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            family: 4,
            maxPoolSize: 50,
            minPoolSize: 5,
        };

        const conn = mongoose.createConnection(this.config.NUMBER_DB_URI, dbOptions);

        conn.on('connected', () => {
            this.dbConnected = true;
            this.NumberModel = conn.model('Number', numberSchema);
            this.emit('log', '✅ Database Connected Successfully');
        });

        conn.on('disconnected', () => {
            this.dbConnected = false;
            this.emit('error', '⚠️ Database Disconnected!');
        });

        conn.on('error', (err) => {
            this.dbConnected = false;
            this.emit('error', `❌ Database Connection Error: ${err.message}`);
        });
    }

    async updateUserAgents() {
        this.emit('log', `✅ Using Dynamic Chrome Browser User Agent Generator`);
    }

    getRandomUA() {
        const chromeVersion = Math.floor(Math.random() * (124 - 115 + 1)) + 115;
        const buildNumber = Math.floor(Math.random() * (9999 - 1000 + 1)) + 1000;
        const isDesktop = Math.random() < 0.5;

        if (isDesktop) {
            const winVer = Math.random() < 0.5 ? "10.0" : "11.0";
            return `Mozilla/5.0 (Windows NT ${winVer}; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion}.0.${buildNumber}.0 Safari/537.36`;
        } else {
            const androidVer = Math.floor(Math.random() * (14 - 10 + 1)) + 10;
            const models = ['SM-S918B', 'Pixel 8', 'SM-G991B', '22101320G'];
            const model = models[Math.floor(Math.random() * models.length)];
            return `Mozilla/5.0 (Linux; Android ${androidVer}; ${model}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion}.0.${buildNumber}.0 Mobile Safari/537.36`;
        }
    }

    // ✅ NEW: Advanced Pro Headers (To bypass 503 & WAF)
    getBrowserHeaders(user, type = 'page') {
        // ইউজার এজেন্ট থেকে ভার্সন বের করার চেষ্টা, না পেলে ডিফল্ট ১২০
        const ua = user.currentUA || "";
        const isMobile = ua.includes("Android") || ua.includes("Mobile");
        const platform = isMobile ? '"Android"' : '"Windows"';
        const mobileHeader = isMobile ? '?1' : '?0';

        const headers = {
            "Host": user.serverIp,
            "User-Agent": user.currentUA,
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br", // br (Brotli) যুক্ত করা হলো
            "Connection": "keep-alive",
            "Cache-Control": "max-age=0",
            // 🔥 Pro Headers (Client Hints) - এগুলো সার্ভারকে রিয়েল ব্রাউজার ভাবতে বাধ্য করে
            "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            "Sec-Ch-Ua-Mobile": mobileHeader,
            "Sec-Ch-Ua-Platform": platform,
            "DNT": "1", // Do Not Track
            "Upgrade-Insecure-Requests": "1"
        };

        if (type === 'page') {
            // Headers for navigating to a page (Login GET)
            Object.assign(headers, {
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
                "Sec-Fetch-User": "?1"
            });
        } else if (type === 'xhr') {
            // Headers for API calls (AJAX)
            Object.assign(headers, {
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "X-Requested-With": "XMLHttpRequest",
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "same-origin"
            });
        }

        if (user.cookies) {
            headers["Cookie"] = user.cookies;
        }

        return headers;
    }

    getTodayDate() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    getServerUrls(user, sesskey = "") {
        const baseUrl = `${user.protocol}://${user.serverIp}${user.basePath}`;
        const today = this.getTodayDate();
        const fdate1 = encodeURIComponent(`${today} 00:00:00`);
        const fdate2 = encodeURIComponent(`${today} 23:59:59`);
        
        // sesskey থাকলে তা ইউআরএলে যোগ হবে
        const sessPart = sesskey ? `&sesskey=${sesskey}` : "";

        return {
            LOGIN_PAGE_URL: `${baseUrl}/login`,
            LOGIN_POST_URL: `${baseUrl}/signin`,
            DASHBOARD_URL: `${baseUrl}/client/SMSCDRStats`,
            API_URL: `${baseUrl}/client/res/data_smscdr.php?fdate1=${fdate1}&fdate2=${fdate2}${sessPart}&frange=&fnum=&fcli=&fgdate=&fgmonth=&fgrange=&fgnumber=&fgcli=&fg=0&sEcho=1&iColumns=7&sColumns=%2C%2C%2C%2C%2C%2C&iDisplayStart=0&iDisplayLength=25&mDataProp_0=0&sSearch_0=&bRegex_0=false&bSearchable_0=true&bSortable_0=true&mDataProp_1=1&sSearch_1=&bRegex_1=false&bSearchable_1=true&bSortable_1=true&mDataProp_2=2&sSearch_2=&bRegex_2=false&bSearchable_2=true&bSortable_2=true&mDataProp_3=3&sSearch_3=&bRegex_3=false&bSearchable_3=true&bSortable_3=true&mDataProp_4=4&sSearch_4=&bRegex_4=false&bSearchable_4=true&bSortable_4=true&mDataProp_5=5&sSearch_5=&bRegex_5=false&bSearchable_5=true&bSortable_5=true&mDataProp_6=6&sSearch_6=&bRegex_6=false&bSearchable_6=true&bSortable_6=true&sSearch=&bRegex=false&iSortCol_0=0&sSortDir_0=desc&iSortingCols=1`
        };
    }

    handleCookies(user, headers) {
        const setCookie = headers['set-cookie'];
        if (setCookie) {
            let cookieMap = {};
            if (user.cookies) {
                user.cookies.split(';').forEach(c => {
                    const [key, val] = c.split('=');
                    if (key) cookieMap[key.trim()] = val ? val.trim() : "";
                });
            }
            setCookie.forEach(c => {
                const parts = c.split(';')[0].split('=');
                if (parts.length >= 2) {
                    cookieMap[parts[0].trim()] = parts.slice(1).join('=').trim();
                }
            });
            user.cookies = Object.entries(cookieMap)
                .map(([k, v]) => `${k}=${v}`)
                .join('; ');
        }
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
        if (!row || !Array.isArray(row)) return null;
        const msgIndex = 4;
        const rawNumber = row[2] ? String(row[2]) : "";
        const rawMessage = row[msgIndex] ? String(row[msgIndex]) : "";
        const id = row[0] || "unknown";
        const uniqueHash = `${id}_${rawNumber}_${rawMessage.substring(0, 20)}`;
        return {
            id: uniqueHash,
            displayId: id,
            number: rawNumber,
            cli: row[3] || "Service",
            message: rawMessage,
            countryData: this.getCountryInfo(rawNumber),
        };
    }

    async sendToGroup(sms) {
        if (!sms) return;
        const otp = this.extractOtp(sms.message) || "N/A";
        const { name: countryName, flag } = sms.countryData;
        const service = sms.cli;
        let maskedNumber = sms.number;
        if (maskedNumber && maskedNumber.length >= 7) {
            const visibleStart = maskedNumber.substring(0, 6);
            const visibleEnd = maskedNumber.substring(maskedNumber.length - 4);
            maskedNumber = `${visibleStart}𝚂𝙼𝚂${visibleEnd}`;
        }

        // 👇 মেসেজ ফরম্যাট আপডেট করা হয়েছে
        const finalMsg = `✅ ${flag} <b>${countryName} ${service} Otp Code Received Successfully</b> 🎉

🔑 <b>𝗬𝗼𝘂𝗿 𝗢𝗧𝗣:</b>  <code>${otp}</code>

☎️ <b>Number:</b> <code>${maskedNumber}</code>
⚙️ <b>Service:</b> ${service}
🌍 <b>Country:</b> ${countryName} ${flag}
🖥️ <b>Server :</b> ${sms.serverLabel}

📩 <b>𝗙𝘂𝗹𝗹-𝗠𝗲𝘀𝘀𝗮𝗴𝗲:</b>
<pre>${sms.message}</pre>`;
        
        const options = {
            parse_mode: "HTML",
            disable_web_page_preview: true,
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "🚀 Panel", url: this.config.GROUP_LINKS.NUMBER_PANEL_LINK },
                        { text: "☎️ Support ", url: this.config.GROUP_LINKS.MAIN_CHANNEL_LINK }
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

    async sendToUser(sms) {
        if (!sms || !sms.number || !sms.message) return;
        if (!this.dbConnected || !this.NumberModel) return;

        const otp = this.extractOtp(sms.message);
        const cleanNumber = String(sms.number).replace(/\D/g, "");

        try {
            const record = await this.NumberModel.findOne({
                number: { $regex: new RegExp(cleanNumber + "$") },
                status: 'Used',
                assigned_to: { $ne: null }
            }).maxTimeMS(4000).exec();

            if (record && record.assigned_to) {
                const userId = record.assigned_to;
                const dbCountryName = record.country;
                const flag = record.flag || sms.countryData.flag;
                let finalOtpPart = "";
                if (otp) finalOtpPart = `🔑 OTP : <code>${otp}</code>`;
                const finalMsg = `🌎 Country : ${dbCountryName} ${flag}
📢 Number : <code>${cleanNumber}</code>
${finalOtpPart}

✅ Stay With Us.💖`;
                await this.botUser.sendMessage(userId, finalMsg, { parse_mode: "HTML" });
                this.emit('sms', `✅ Private OTP sent to User: ${userId}`);
            }
        } catch (e) {}
    }

    async performLogin(user) {
        user.currentUA = this.getRandomUA();
        user.cookies = "";
        let urls = this.getServerUrls(user);

        try {
            this.emit('log', `🔐 Logging in [${user.serverName}/${user.username}]...`);

            const getRes = await user.client.get(urls.LOGIN_PAGE_URL, {
                headers: this.getBrowserHeaders(user, 'page')
            });
            this.handleCookies(user, getRes.headers);

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

            const loginHeaders = this.getBrowserHeaders(user, 'page');
            Object.assign(loginHeaders, {
                "Content-Type": "application/x-www-form-urlencoded",
                "Referer": urls.LOGIN_PAGE_URL,
                "Origin": `${user.protocol}://${user.serverIp}`
            });

            const postRes = await user.client.post(urls.LOGIN_POST_URL, formParams.toString(), {
                headers: loginHeaders,
                maxRedirects: 0,
                validateStatus: s => s >= 200 && s < 400,
            });
            this.handleCookies(user, postRes.headers);

            // --- নতুন অংশ: sesskey এক্সট্রাক্ট করা ---
            const dashRes = await user.client.get(urls.DASHBOARD_URL, {
                headers: this.getBrowserHeaders(user, 'page')
            });
            
            // HTML থেকে sesskey খুঁজে বের করা (সাধারণত এটি সোর্স কোডে থাকে)
            const dashHtml = String(dashRes.data || "");
            const keyMatch = dashHtml.match(/sesskey=([A-Za-z0-9+/=]+)/) || dashHtml.match(/["']sesskey["']\s*:\s*["']([^"']+)["']/);
            
            if (keyMatch && keyMatch[1]) {
                user.sesskey = keyMatch[1];
                this.emit('log', `🔑 Extracted SessKey: ${user.sesskey}`);
            } else {
                user.sesskey = ""; // না পাওয়া গেলে খালি থাকবে
            }
            // ---------------------------------------

            if (postRes.status === 302 || postRes.status === 200) {
                this.emit('log', `✅ Login successful [${user.serverName}/${user.username}]`);
                return true;
            }
            return false;
        } catch (err) {
            this.emit('error', `Login error [${user.serverName}/${user.username}]: ${err.message}`);
            return false;
        }
    }

    async fetchSmsApi(user) {
        // sesskey সহ নতুন URL তৈরি
        const urls = this.getServerUrls(user, user.sesskey);
        try {
            const apiHeaders = this.getBrowserHeaders(user, 'xhr');
            Object.assign(apiHeaders, {
                "Referer": urls.DASHBOARD_URL,
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "same-origin"
            });

            const res = await user.client.get(urls.API_URL, {
                headers: apiHeaders
            });
            return res.data;
        } catch (e) {
            throw e;
        }
    }

    async loop(user) {
        try {
            // ডুপ্লিকেট মেসেজ ট্র্যাক করার জন্য লিস্ট (না থাকলে তৈরি হবে)
            if (!user.processedIds) user.processedIds = [];

            const data = await this.fetchSmsApi(user);

            if (data && Array.isArray(data.aaData) && data.aaData.length > 0) {
                // প্যানেলের একদম উপরের মেসেজটি নেওয়া
                const latest = this.mapRow(data.aaData[0]);

                if (!latest) {
                    setTimeout(() => this.loop(user), 3000);
                    return;
                }

                // --- লজিক শুরু ---

                // ১. বোট চালু হওয়ার পর প্রথমবার চেক (Startup)
                if (user.lastId === null) {
                    user.lastId = latest.id;
                    user.processedIds.push(latest.id);

                    this.emit('log', `🚀 Startup [${user.serverName}]: Sending last existing message...`);
                    
                    // প্যানেলে থাকা লেটেস্ট মেসেজটি একবারই পাঠাবে
                    await this.sendToGroup(latest);
                   await this.sendToUser(latest);
                } 
                // ২. নতুন কোন মেসেজ আসলে (এবং যদি তা আগে পাঠানো না হয়ে থাকে)
                else if (latest.id !== user.lastId && !user.processedIds.includes(latest.id)) {
                    
                    user.lastId = latest.id;
                    user.processedIds.push(latest.id);

                    // মেমোরি ক্লিয়ার রাখা (লিস্টে সর্বোচ্চ ৩০টি আইডি জমা রাখবে)
                    if (user.processedIds.length > 30) {
                        user.processedIds.shift();
                    }

                    this.emit('sms', `🔥 New OTP Received [${user.serverName}]: ${latest.displayId}`);
                    
                    // নতুন মেসেজ একবার পাঠাবে
                    await this.sendToGroup(latest);
                    await this.sendToUser(latest);
                }

                // স্বাভাবিক বিরতি (২-৪ সেকেন্ড)
                const randomDelay = Math.floor(Math.random() * 2000) + 2000;
                setTimeout(() => this.loop(user), randomDelay);

            } else {
                // ডাটা না থাকলে ৫ সেকেন্ড পর আবার ট্রাই করবে
                setTimeout(() => this.loop(user), 5000);
            }
        } catch (e) {
            const errMsg = e.message || "";
            // সার্ভারের স্ট্যাটাস কোড চেক করা (যেমন: 503, 502, 504)
            const status = e.response ? e.response.status : null;

            // ✅ ফিক্স: 503 বা 502 এরর আসলে লগইন না করে ৩০ সেকেন্ড অপেক্ষা করা
            if (status === 503 || status === 502 || status === 504) {
                this.emit('log', `⚠️ Server Busy (${status}) [${user.serverName}]: Pausing for 30s to protect IP...`);
                setTimeout(() => this.loop(user), 30000); // ৩০ সেকেন্ড অপেক্ষা
                return;
            }

            // কানেকশন জনিত এরর হলে চুপচাপ ৫ সেকেন্ড পর আবার ট্রাই করবে
            if (errMsg.includes('socket') || errMsg.includes('timeout') || errMsg.includes('ECONN') || errMsg.includes('ETIMEDOUT') || errMsg.includes('Network Error')) {
                setTimeout(() => this.loop(user), 5000);
            } 
            // অন্য কোনো সমস্যা হলে নতুন করে লগইন করবে
            else {
                this.emit('error', `Loop Error [${user.serverName}]: ${errMsg}`);
                
                setTimeout(async () => {
                    const loggedIn = await this.performLogin(user);
                    if (loggedIn) {
                        this.loop(user);
                    } else {
                        // লগইন ফেইল হলে ২০ সেকেন্ড পর startUser কল করবে
                        setTimeout(() => this.startUser(user), 20000);
                    }
                }, 5000);
            }
        }
    }

    async startUser(user) {
        user.client = axios.create({ 
            timeout: 25000,
            httpAgent: httpAgent, 
            httpsAgent: httpsAgent,
            maxRedirects: 5,
            validateStatus: status => status >= 200 && status < 500
        });

        const ok = await this.performLogin(user);
        if (!ok) {
            this.emit('error', `Login failed [${user.serverName}/${user.username}], retrying in 20s...`);
            setTimeout(() => this.startUser(user), 20000);
            return;
        }
        this.loop(user);
    }

    async start() {
        this.emit('log', '🚀 Universal Multi-Server Worker Starting (Headers Optimized)...');
        
        if (!this.loadServersConfig()) {
            this.emit('error', 'Failed to load server configuration! Check pass.json');
            return;
        }

        await this.updateUserAgents();
        let delay = 0;
        for (const user of this.allUsers) {
            setTimeout(() => {
                this.emit('log', `▶️ Starting [${user.serverName}/${user.username}]...`);
                this.startUser(user);
            }, delay);
            delay += 2000;
        }
    }
}

module.exports = Russel;