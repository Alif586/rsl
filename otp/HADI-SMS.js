const axios = require("axios").default;
const tough = require("tough-cookie");
const { wrapper } = require("axios-cookiejar-support");
const cheerio = require("cheerio");
const TelegramBot = require("node-telegram-bot-api");
const { parsePhoneNumberFromString } = require("libphonenumber-js");
const countryEmoji = require("country-emoji");
const mongoose = require("mongoose");
const EventEmitter = require("events");

class OtpWorker7 extends EventEmitter {
    constructor() {
        super();
        this.config = null;
        this.botGroup = null;
        this.botUser = null;
        this.NumberModel = null;

        
        this.SERVER_IP = "185.2.83.39"; 

        this.users = [
            { 
                onServer: true,
                username: "Rasel6669", 
                password: "Rasel6669", 
                Server : ["HDI-1"], 
                lastId: null,
                jar: null, 
                client: null 
            },
            {
                onServer: true,
                username: "rasel01", 
                password: "rasel01", 
                Server : ["HDI-2"],
                lastId: null, 
                jar: null, 
                client: null 
            },
            {
                onServer: true,
                username: "Rasel6661", 
                password: "Rasel6661", 
                Server : ["HDI-2"],
                lastId: null, 
                jar: null, 
                client: null 
            }
            
        ]; 

        this.GLOBAL_USER_AGENTS = ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/121.0.0.0 Safari/537.36"];
        this.BASE_URL = `http://${this.SERVER_IP}/ints`;
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
        this.botUser = new TelegramBot(this.config.BOT_TOKENS.USER_BOT, opts);
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

    async sendTelegramWithRetry(bot, chatId, message, options, retries = 0) {
        try {
            await bot.sendMessage(chatId, message, options);
            return true;
        } catch (error) {
            // console.error(`Telegram Error: ${error.message}`); // ডিবাগিংয়ের জন্য অন রাখতে পারেন
            if (retries < this.MAX_RETRIES) {
                await new Promise(r => setTimeout(r, 2000 * (retries + 1)));
                return this.sendTelegramWithRetry(bot, chatId, message, options, retries + 1);
            }
            return false;
        }
    }

    // ফিক্স: user প্যারামিটার যোগ করা হয়েছে যাতে সার্ভারের নাম ডাইনামিক হয়
    async sendToGroup(sms, user) {
        const otp = this.extractOtp(sms.message) || "N/A";
        const { name: countryName, flag } = sms.countryData;
        const service = sms.cli;

        // ইউজারের কনফিগ থেকে সার্ভার নাম বের করা হচ্ছে
        const serverName = (user && user.Server && user.Server.length > 0) ? user.Server[0] : "Unknown";

        let maskedNumber = sms.number;
        if (maskedNumber.length >= 7) {
            maskedNumber = maskedNumber.substring(0, 6) + "𝚂𝙼𝚂" + maskedNumber.substring(maskedNumber.length - 4);
        }

        const finalMsg = `✅ ${flag} <b>${countryName} ${service} Otp Code Received Successfully</b> 🎉

🔐 <b>𝗬𝗼𝘂𝗿 𝗢𝗧𝗣:</b>  <code>${otp}</code>

☎️ <b>Number:</b> <code>${maskedNumber}</code>
⚙️ <b>Service:</b> ${service}
🌍 <b>Country:</b> ${countryName} ${flag}
🖥️ <b>Server :</b> [${serverName}]


📩 <b>𝗙𝘂𝗹𝗹-𝗠𝗲𝘀𝘀𝗮𝗴𝗲:</b>
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

        await this.sendTelegramWithRetry(this.botGroup, this.config.GROUP_LINKS.OTP_GROUP_ID, finalMsg, options);
        this.emit('sms', `Group Msg Sent: ${otp} (Server: ${serverName})`);
    }

    async sendToUser(sms) {
        try {
            const cleanNum = String(sms.number).replace(/\D/g, "");
            const record = await this.NumberModel.findOne({
                number: { $regex: new RegExp(cleanNum + "$") },
                status: 'Used', assigned_to: { $ne: null }
            });

            if (record) { 
                const otp = this.extractOtp(sms.message);
                const dbCountryName = record.country;
                const flag = record.flag || sms.countryData.flag;

                let finalOtpPart = "";
                if (otp) {
                    finalOtpPart = `🔐 OTP : <code>${otp}</code>`;
                }

                const finalMsg = `🌎 Country : ${dbCountryName} ${flag}
📢 Number : <code>${cleanNum}</code>
${finalOtpPart}

✅ Stay With Us.💖`;

                await this.sendTelegramWithRetry(this.botUser, record.assigned_to, finalMsg, { parse_mode: "HTML" });
            }
        } catch (e) { /* ignore */ }
    }

    extractOtp(text) {
        if (!text) return null;
        let clean = text.replace(/<[^>]*>?/gm, ' ');
        const match = clean.match(/(?:code|otp|pin|pass)[^0-9]*([\d -]{4,8})/i) || clean.match(/\b(\d{4,8})\b/);
        return match ? match[1].replace(/\D/g, "") : null;
    }

    getCountryInfo(number) {
        try {
            let s = number.startsWith("+") ? number : "+" + number.replace(/^00/, "");
            const p = parsePhoneNumberFromString(s);
            if (p) return { name: countryEmoji.name(p.country) || p.country, flag: countryEmoji.flag(p.country) || "🌍" };
        } catch (e) {}
        return { name: "Unknown", flag: "🌍" };
    }

    async performLogin(user) {
        try {
            user.client.defaults.headers.common['User-Agent'] = this.GLOBAL_USER_AGENTS[0];
            const loginPage = await user.client.get(`${this.BASE_URL}/login`);

            const $ = cheerio.load(loginPage.data);
            let capt = null;
            const q = $("body").text().match(/What is\s*(\d+)\s*([+\-*\/])\s*(\d+)/i);
            if (q) {
                const [_, a, op, b] = q;
                capt = eval(`${a} ${op === 'x' ? '*' : op} ${b}`);
            }

            const params = new URLSearchParams();
            params.append("username", user.username);
            params.append("password", user.password);
            if (capt !== null) params.append("capt", capt);
            $("form input[type=hidden]").each((_, el) => params.append($(el).attr("name"), $(el).val()));

            await user.client.post(`${this.BASE_URL}/signin`, params.toString(), {
                maxRedirects: 0,
                validateStatus: s => s >= 200 && s < 400
            });
            return true;
        } catch (e) { return false; }
    }

    async loop(user) {
        try {
            const today = new Date().toISOString().split('T')[0];
            const url = `${this.BASE_URL}/client/res/data_smscdr.php?fdate1=${today}%2000:00:00&fdate2=${today}%2023:59:59&frange=&fnum=&fcli=&fgdate=&fgmonth=&fgrange=&fgnumber=&fgcli=&fg=0&sEcho=1&iColumns=7&sColumns=%2C%2C%2C%2C%2C%2C&iDisplayStart=0&iDisplayLength=15&mDataProp_0=0&sSearch_0=&bRegex_0=false&bSearchable_0=true&bSortable_0=true&mDataProp_1=1&sSearch_1=&bRegex_1=false&bSearchable_1=true&bSortable_1=true&mDataProp_2=2&sSearch_2=&bRegex_2=false&bSearchable_2=true&bSortable_2=true&mDataProp_3=3&sSearch_3=&bRegex_3=false&bSearchable_3=true&bSortable_3=true&mDataProp_4=4&sSearch_4=&bRegex_4=false&bSearchable_4=true&bSortable_4=true&mDataProp_5=5&sSearch_5=&bRegex_5=false&bSearchable_5=true&bSortable_5=true&mDataProp_6=6&sSearch_6=&bRegex_6=false&bSearchable_6=true&bSortable_6=true&sSearch=&bRegex=false&iSortCol_0=0&sSortDir_0=desc&iSortingCols=1`;

            const res = await user.client.get(url, { headers: { "X-Requested-With": "XMLHttpRequest" } });

            if (res.data && res.data.aaData && res.data.aaData.length > 0) {
                const row = res.data.aaData[0];
                const id = `${row[0]}_${row[2]}`;
                const sms = {
                    number: String(row[2]),
                    cli: row[3],
                    message: String(row[4]),
                    countryData: this.getCountryInfo(String(row[2]))
                };

                // FIX: Send message if it's the first run (startup) OR if it's a new ID
                if (user.lastId === null || user.lastId !== id) {
                    this.emit('sms', `🔥 SMS [${user.username}] - Sending...`);
                    // ফিক্স: user অবজেক্ট পাস করা হলো
                    await this.sendToGroup(sms, user);
                    await this.sendToUser(sms);
                    user.lastId = id;
                } else {
                    if (process.stdout.writable) process.stdout.write(".");
                }
            }
        } catch (e) {
            this.emit('error', `Loop Error [${user.username}]: ${e.message}`);
            await new Promise(r => setTimeout(r, 5000));
            await this.performLogin(user);
        } finally {
            setTimeout(() => this.loop(user), 3000);
        }
    }

    async startUser(user) {
        user.jar = new tough.CookieJar();
        user.client = wrapper(axios.create({ jar: user.jar, timeout: 20000, withCredentials: true }));
        if (await this.performLogin(user)) {
            this.emit('log', `✅ Login [${user.username}] Server: [${user.Server}]`);
            this.loop(user);
        } else {
            this.emit('error', `❌ Login Failed [${user.username}]`);
            setTimeout(() => this.startUser(user), 10000);
        }
    }

    async start() {
        this.users.forEach((u, i) => setTimeout(() => this.startUser(u), i * 2000));
    }
}

module.exports = OtpWorke7;
