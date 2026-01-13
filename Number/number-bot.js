/* ========= Number Bot (Optimized: High Concurrency + Smooth Animation) =========== */

const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const request = require('request');
const countryEmoji = require('country-emoji');
const mongoose = require('mongoose');

// ===============================================
// ✅ কনফিগারেশন
// ===============================================
const BOT_TOKEN = '8499409386:AAE7w7F61I3PBGY8NwGYE7xEcaSrEW8n6Yw';
const AUTHORIZED_BOT_ID = 8499409386;
const OTP_GROUP_URL = "https://t.me/OTP_fast_Mobile_Tips";

const GITHUB_USERNAME = "sabbiR6251";
const GITHUB_REPO_NAME = "User";
const GITHUB_FILE_PATH = "users.json";

const NUMBER_DB_URI = "mongodb+srv://bangladesh900200_db_user:Rasel123@number.kfxm7hy.mongodb.net/Number?retryWrites=true&w=majority";

const USER_DB_URI = "mongodb+srv://mdrasel666699990_db_user:Rasel123@user.xiwhpml.mongodb.net/UserDB?appName=User";

const USER_LIST_FILE = 'users.json';

const REQUIRED_CHANNELS = [
    { id: -1002705017038, url: "https://t.me/+iO8PT7OV2MAwODU1" },
    { id: -1003631989602, url: "https://t.me/TG_SELL_RRM_MTE" },
    { id: -1002963724688, url: "https://t.me/OTP_fast_Mobile_Tips" },
];

const ADMIN_IDS = [6006322754, 6988614485, 8275550907, 8535062924, 8249168527];
const SUPPORT_USERNAME = "Group_owner_Rasel";
const COOLDOWN_TIME = 2;

// ===============================================
// 🆕 মেসেজ টেমপ্লেট
// ===============================================
const ASSIGNMENT_MESSAGE_TEMPLATE = (
  flag,
  country_name,
  number,
  action_text
) => `
${flag} <b>${country_name} Fresh Number ${action_text}</b>

Number: <code>${number}</code>

<blockquote>⏳বটের ভিতরে 5 সেকেন্ড ওয়েট করুন ওটিপি না পেলে গ্রুপ চেক করুন</blockquote>
`;

const NEW_FOOTER_QUOTE = ""; // Optional footer text (empty by default)



// ===============================================
// 🗄️ DATABASE CONNECTION SETUP
// ===============================================
// ===============================================
// 🗄️ DATABASE CONNECTION SETUP (FIXED)
// ===============================================
const dbOptions = {
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 45000,
    family: 4,
    maxPoolSize: 50,
    minPoolSize: 5,
    connectTimeoutMS: 10000,
    maxIdleTimeMS: 30000,
    compressors: 'zlib',
    // ✅ SSL/TLS FIX
    tls: true,
    tlsAllowInvalidCertificates: false,
    tlsAllowInvalidHostnames: false,
    retryWrites: true,
    retryReads: true
};

const numberConn = mongoose.createConnection(NUMBER_DB_URI, dbOptions);
const userConn = mongoose.createConnection(USER_DB_URI, dbOptions);

// ✅ Define Schemas AFTER connections
const numberSchema = new mongoose.Schema({
    number: { type: String, unique: true, required: true },
    country: { type: String, required: true },
    flag: { type: String, default: "🌍" },
    status: { type: String, enum: ['Available', 'Used', 'Used_History'], default: 'Available' },
    assigned_to: { type: Number, default: null },
    assigned_at: { type: Date, default: null },
    created_at: { type: Date, default: Date.now }
});

const userSchema = new mongoose.Schema({
    userId: { type: Number, unique: true, required: true },
    joined_at: { type: Date, default: Date.now }
});

const configSchema = new mongoose.Schema({
    key: { type: String, unique: true, required: true },
    value: { type: String, required: true }
});

// ✅ Create Models
const NumberModel = numberConn.model('Number', numberSchema);
const UserModel = userConn.model('User', userSchema);
const ConfigModel = userConn.model('Config', configSchema);

// ✅ Connection Event Handlers
numberConn.on('connected', async () => {
    console.log("✅ Number DB Connected!");
    await setupDatabaseIndexes();
});

numberConn.on('error', (err) => {
    console.error("❌ Number DB Error:", err.message);
});

userConn.on('connected', () => {
    console.log("✅ User & Config DB Connected!");
    syncSystem();
});

userConn.on('error', (err) => {
    console.error("❌ User DB Error:", err.message);
});

// ✅ Bot Initialization
const bot = new TelegramBot(BOT_TOKEN, { 
    polling: { 
        interval: 1000,
        autoStart: true,
        params: {
            timeout: 30
        }
    } 
});


// ===============================================
// 🔥 DATABASE INDEX SETUP
// ===============================================
async function setupDatabaseIndexes() {
    try {
        await NumberModel.collection.createIndex({ country: 1, status: 1 });
        console.log("✅ Index: country + status");
        
        await NumberModel.collection.createIndex({ assigned_to: 1, status: 1 });
        console.log("✅ Index: assigned_to + status");
        
        await NumberModel.collection.createIndex(
            { assigned_at: 1 }, 
            { 
                expireAfterSeconds: 7200,
                partialFilterExpression: { status: 'Used' }
            }
        );
        console.log("✅ TTL Index: Auto-delete after 2 hours");
        
    } catch (error) {
        console.error("❌ Index error:", error.message);
    }
}


// ===============================================
// 🛡️ ERROR HANDLING
// ===============================================
bot.on('polling_error', (error) => {
    console.log(`[Polling Error] ${error.code}: ${error.message}`);
});

process.on('unhandledRejection', (reason, promise) => {
    const safeErrors = [
        'query is too old',
        'message is not modified',
        'bot was blocked',
        'user is deactivated',
        'ETELEGRAM: 403'
    ];
    
    const errorMsg = reason?.message || String(reason);
    
    if (!safeErrors.some(err => errorMsg.includes(err))) {
        console.error('⚠️ Unhandled Rejection:', errorMsg);
    }
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error.message);
});

// ===============================================
// 🗂️ GLOBAL VARIABLES
// ===============================================
let bot_users = new Set();
let admin_country_temp_data = {};
let last_action_time = {};
let user_details_cache = {};
let country_data_cache = {};
let user_states = {};
let admin_file_buffer = {};
let last_change_time = {};
let country_assignment_locks = {};
let countryToIndex = {};
let indexToCountry = {};
let bot_username = "";
let add_session_data = [];
let last_add_timestamp = 0;
let last_channel_msg_ids = {};

bot.getMe().then((me) => {
    bot_username = me.username;
    console.log(`✅ Bot Username: @${bot_username}`);
});

// ===============================================
// 🔧 UTILITY FUNCTIONS
// ===============================================
async function safeEditMessage(chatId, msgId, text, options = {}) {
    try {
        await bot.editMessageText(text, {
            chat_id: chatId,
            message_id: msgId,
            ...options
        });
    } catch (error) {
        if (error.response && error.response.body) {
            const errDesc = error.response.body.description;
            if (!errDesc.includes('message is not modified')) {
                console.error('Edit error:', errDesc);
            }
        }
    }
}

async function safeAnswerCallback(callbackQueryId, options = {}) {
    try {
        await bot.answerCallbackQuery(callbackQueryId, options);
    } catch (error) {
        if (!error.message.includes('query is too old')) {
            console.error('Callback error:', error.message);
        }
    }
}


// ===============================================
// 🕐 AUTO DELETE CLAIMED NUMBERS AFTER 2 HOURS
// ===============================================
async function autoDeleteExpiredNumbers() {
    try {
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

        const result = await NumberModel.deleteMany({
            status: 'Used',
            assigned_at: { $lt: twoHoursAgo }
        });

        if (result.deletedCount > 0) {
            console.log(`🗑️ Auto-deleted ${result.deletedCount} expired claimed numbers (2+ hours old)`);
            await rebuildCountryCache();
        }
    } catch (error) {
        console.error("Auto-delete error:", error);
    }
}

setInterval(autoDeleteExpiredNumbers, 10 * 60 * 1000);
setTimeout(autoDeleteExpiredNumbers, 5000);
// ===============================================
// 🔄 GITHUB & DB SYNC LOGIC
// ===============================================
async function getGitHubToken() {
    const conf = await ConfigModel.findOne({ key: "github_token" });
    return conf ? conf.value : null;
}

async function fetchGithubUsers(token) {
    if (!token) return null;
    const url = `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO_NAME}/contents/${GITHUB_FILE_PATH}`;

    return new Promise((resolve) => {
        request({
            url: url,
            headers: { 'User-Agent': 'NodeBot', 'Authorization': `token ${token}` }
        }, (err, res, body) => {
            if (err || res.statusCode !== 200) {
                console.log("GitHub Fetch Error or 404 (File might not exist yet).");
                resolve(null);
            } else {
                try {
                    const json = JSON.parse(body);
                    const content = Buffer.from(json.content, 'base64').toString('utf8');
                    resolve({ content: JSON.parse(content), sha: json.sha });
                } catch (e) {
                    resolve(null);
                }
            }
        });
    });
}

async function uploadToGithub(usersArray, token, sha = null) {
    if (!token) return;
    const url = `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO_NAME}/contents/${GITHUB_FILE_PATH}`;
    const contentEncoded = Buffer.from(JSON.stringify(usersArray, null, 2)).toString('base64');

    const bodyData = {
        message: "Update users.json via Bot",
        content: contentEncoded,
        sha: sha
    };

    request({
        url: url,
        method: 'PUT',
        headers: {
            'User-Agent': 'NodeBot',
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json'
        },
        json: true,
        body: bodyData
    }, (err, res, body) => {
        if (err) console.error("GitHub Upload Error:", err);
        else console.log("✅ GitHub Updated Successfully.");
    });
}

async function syncSystem() {
    console.log("🔄 Starting Sync System...");
    const token = await getGitHubToken();

    const mongoUsersDocs = await UserModel.find({});
    const mongoUserIds = new Set(mongoUsersDocs.map(u => u.userId));

    let githubData = await fetchGithubUsers(token);
    let githubUserIds = new Set();
    if (githubData && Array.isArray(githubData.content)) {
        githubUserIds = new Set(githubData.content);
    }

    const allUsers = new Set([...mongoUserIds, ...githubUserIds, ...bot_users]);
    ADMIN_IDS.forEach(id => allUsers.add(id));

    bot_users = allUsers;

    const newForMongo = [];
    allUsers.forEach(uid => {
        if (!mongoUserIds.has(uid)) {
            newForMongo.push({ userId: uid });
        }
    });

    if (newForMongo.length > 0) {
        await UserModel.insertMany(newForMongo, { ordered: false }).catch(() => {});
        console.log(`📥 Added ${newForMongo.length} users to MongoDB from Sync.`);
    }

    if (token) {
        const finalArray = Array.from(allUsers);
        if (finalArray.length !== githubUserIds.size || newForMongo.length > 0) {
            await uploadToGithub(finalArray, token, githubData ? githubData.sha : null);
        }
    }

    try {
        fs.writeFileSync(USER_LIST_FILE, JSON.stringify(Array.from(allUsers), null, 4));
    } catch (e) {}

    console.log(`✅ Sync Complete. Total Users: ${allUsers.size}`);
}

async function addUserToLocalDb(userId) {
    if (!bot_users.has(userId)) {
        bot_users.add(userId);

        try {
            await new UserModel({ userId: userId }).save();
        } catch (e) {}

        try {
            fs.writeFileSync(USER_LIST_FILE, JSON.stringify(Array.from(bot_users), null, 4));
        } catch (e) {}

        const token = await getGitHubToken();
        if (token) {
            const ghData = await fetchGithubUsers(token);
            await uploadToGithub(Array.from(bot_users), token, ghData ? ghData.sha : null);
        }
    }
}

// ===============================================
// ⚙️ Helper Functions
// ===============================================
// ✅ OPTIMIZED: Cache rebuild with rate limiting
let lastCacheRebuild = 0;
const CACHE_REBUILD_INTERVAL = 5000; // 5 seconds minimum

async function rebuildCountryCache() {
    const now = Date.now();
    
    // Skip if rebuilt recently
    if (now - lastCacheRebuild < CACHE_REBUILD_INTERVAL) {
        return;
    }
    
    lastCacheRebuild = now;
    
    try {
        const result = await NumberModel.aggregate([
            {
                $group: {
                    _id: "$country",
                    flag: { $first: "$flag" },
                    total: { $sum: 1 },
                    available: { 
                        $sum: { 
                            $cond: [{ $eq: ["$status", "Available"] }, 1, 0] 
                        } 
                    }
                }
            }
        ]).allowDiskUse(true);

        country_data_cache = {};
        countryToIndex = {};
        indexToCountry = {};

        let idx = 0;
        result.forEach(r => {
            country_data_cache[r._id] = { 
                flag: r.flag, 
                available: r.available, 
                total: r.total 
            };
            countryToIndex[r._id] = idx;
            indexToCountry[idx] = r._id;
            idx++;
        });
        
        console.log(`✅ Cache rebuilt: ${idx} countries`);
    } catch (e) {
        console.error("Cache rebuild error:", e);
    }
}

function isAdmin(userId) {
    return ADMIN_IDS.includes(userId);
}

async function isUserMember(userId) {
    if (isAdmin(userId)) return true;

    const validStatuses = ['member', 'administrator', 'creator'];

    const checkPromises = REQUIRED_CHANNELS.map(channel => 
        bot.getChatMember(channel.id, userId)
            .then(member => validStatuses.includes(member.status))
            .catch(() => false)
    );

    const results = await Promise.all(checkPromises);
    return results.every(result => result === true);
}

function getAvailableCountriesData() {
    const countryData = {};
    for (const [country, data] of Object.entries(country_data_cache)) {
        if (data.available > 0) countryData[country] = { flag: data.flag, count: data.available };
    }
    return countryData;
}

function getAllCountryList() {
    const countryData = {};
    for (const [country, data] of Object.entries(country_data_cache)) {
        countryData[country] = { flag: data.flag, count: data.total };
    }
    return countryData;
}

function isUserAllowedAction(userId) {
    if (isAdmin(userId)) return { allowed: true, remaining: 0 };
    const currentTime = Date.now() / 1000;
    if (last_action_time[userId] && (currentTime - last_action_time[userId]) < COOLDOWN_TIME) {
        const remaining = (COOLDOWN_TIME - (currentTime - last_action_time[userId])).toFixed(1);
        return { allowed: false, remaining: remaining };
    }
    last_action_time[userId] = currentTime;
    return { allowed: true, remaining: 0 };
}

// ===============================================
// ⌨️ Keyboards
// ===============================================
function getMainMenuKeyboard(userId) {
    const keyboard = [
        [{ text: "📲 Get Number" }, { text: "🌍 Available Country" }],
        [{ text: "✅ Active Number" }, { text: "☎️ Support" }]
    ];
    if (isAdmin(userId)) keyboard.push([{ text: "🔑 Admin Menu" }]);
    return { keyboard: keyboard, resize_keyboard: true };
}

function getAdminMenuKeyboard(inSession = false) {
    if (inSession) return { keyboard: [[{ text: "🛑 Stop" }]], resize_keyboard: true };
    return {
        keyboard: [
            [{ text: "➕ ADD" }, { text: "📢 Broadcast" }],
            [{ text: "📊 Status" }, { text: "🔑 Ass Token" }],
            [{ text: "🗑️ Delete" }, { text: "🔄 Restart" }],
            [{ text: "➡️ Main Menu" }]
        ],
        resize_keyboard: true
    };
}

function getNumberControlKeyboard() {
    return {
        inline_keyboard: [
            [{ text: "View OTP 📩", url: OTP_GROUP_URL }],
            [
                { text: "🔄 Change Number", callback_data: `change_number_req` },
                { text: "🌍 Change Country", callback_data: 'change_country_start' }
            ]
        ]
    };
}

function getDeleteCountryKeyboard() {
    const allCountries = getAllCountryList();
    const buttons = [];
    const keys = Object.keys(allCountries).sort();
    for (let i = 0; i < keys.length; i += 2) {
        const row = [];
        const country1 = keys[i];
        row.push({ 
            text: `${allCountries[country1].flag} ${country1}`, 
            callback_data: `sdc:${countryToIndex[country1]}`
        });
        if (i + 1 < keys.length) {
            const country2 = keys[i + 1];
            row.push({ 
                text: `${allCountries[country2].flag} ${country2}`, 
                callback_data: `sdc:${countryToIndex[country2]}`
            });
        }
        buttons.push(row);
    }
    buttons.push([{ text: "❌ Cancel", callback_data: 'cancel_delete' }]);
    return { inline_keyboard: buttons };
}

function getVerificationMarkup() {
    const buttons = REQUIRED_CHANNELS.map((ch, i) => [{ text: `Join Channel ${i + 1}`, url: ch.url }]);
    buttons.push([{ text: "✅ Verify", callback_data: 'verify_check' }]);
    return { inline_keyboard: buttons };
}


async function sendVerificationPrompt(userId, messageId = null) {
    const text = `⚠️ **Access Denied!**\nPlease join our channels to use the bot.`;
    const markup = getVerificationMarkup();
    if (messageId) {
        try { await safeEditMessage(userId, messageId, text, { parse_mode: 'Markdown', reply_markup: markup }); } catch {}
    } else {
        try {
            await bot.sendMessage(userId, text, { parse_mode: 'Markdown', reply_markup: markup });
        } catch (e) {}
    }
}

// ===============================================
// 📩 COMMAND HANDLER
// ===============================================
bot.on('message', async (msg) => {
    if (!msg.from) return;
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;

    addUserToLocalDb(userId);

    if (!isAdmin(userId)) {
        if (!(await isUserMember(userId))) {
            sendVerificationPrompt(userId);
            return;
        }
    }

    if (user_states[userId]) {
        if (text === '🛑 Stop' || text === 'stop') {
            delete user_states[userId];
            delete admin_file_buffer[userId];
            bot.sendMessage(chatId, "✅ Action cancelled.", { reply_markup: getAdminMenuKeyboard() });
            return;
        }

        // 🔄 RESTART PASSWORD CHECK
        if (user_states[userId] === 'AWAITING_PASS_FOR_RST') {
            if (text === 'sms') {
                delete user_states[userId];
                
                // 🔄 Countdown Message পাঠাচ্ছি
                const countdownMsg = await bot.sendMessage(
                    chatId, 
                    "🔄 **Restarting Bot...**\n\n⏳ Please wait: **6** seconds\n\n⚠️ All buttons disabled!", 
                    { 
                        parse_mode: 'Markdown',
                        reply_markup: { remove_keyboard: true } // সব button hide
                    }
                );
                
                const countdownMsgId = countdownMsg.message_id;
                
                // 📊 Countdown শুরু করছি (6 থেকে 1)
                for (let i = 5; i >= 1; i--) {
                    await new Promise(r => setTimeout(r, 1000)); // 1 second wait
                    
                    try {
                        await bot.editMessageText(
                            `🔄 **Restarting Bot...**\n\n⏳ Please wait: **${i}** seconds\n\n⚠️ All buttons disabled!`,
                            {
                                chat_id: chatId,
                                message_id: countdownMsgId,
                                parse_mode: 'Markdown'
                            }
                        );
                    } catch (e) {
                        // Edit error ignore করছি
                    }
                }
                
                // ✅ Final Success Message
                try {
                    await bot.editMessageText(
                        "✅ **Restart Successful!**\n\n🤖 Bot is now restarting...\n⏰ It will be back online in a moment.",
                        {
                            chat_id: chatId,
                            message_id: countdownMsgId,
                            parse_mode: 'Markdown'
                        }
                    );
                } catch (e) {}
                
                // 🔄 Git Pull & Restart করছি
                const { exec } = require('child_process');
                const BOT_PATH = '/home/alif/rsl'; // 👈 আপনার path
                
                exec(`cd ${BOT_PATH} && git reset --hard && git pull origin main && pm2 restart rsl`, (error, stdout, stderr) => {
                    if (error) {
                        bot.sendMessage(chatId, `❌ **Restart Failed!**\n\n<pre>${error.message}</pre>`, { 
                            parse_mode: 'HTML',
                            reply_markup: getAdminMenuKeyboard() 
                        });
                        return;
                    }
                    
                    // 2 second পরে process exit
                    setTimeout(() => {
                        process.exit(0);
                    }, 2000);
                });
                
            } else {
                // ❌ Wrong Password
                bot.sendMessage(chatId, "🚫 বাল পাকনা, এটা আপনার জন্য না 😅**\n\n" +
"এই অপশনটা শুধু বট ডেভেলপারদের জন্য। ফাইল আপডেট বট আপডেট এর জন্য\n" +
"ভুল করে ঢুকে পড়লে এখনই ব্যাক যান\n👉 @alifhosson", { 
                    reply_markup: getAdminMenuKeyboard() 
                });
                delete user_states[userId];
            }
            return;
        }

        // 🔑 GITHUB TOKEN PASSWORD CHECK
        if (user_states[userId] === 'AWAITING_PASS_FOR_TOKEN') {
            if (text === 'alif') {
                user_states[userId] = 'AWAITING_GITHUB_TOKEN';
                bot.sendMessage(chatId, "🔓 **Password Accepted!**\n\nPlease upload ur github Repo token:", { parse_mode: 'Markdown', reply_markup: getAdminMenuKeyboard(true) });
            } else {
                bot.sendMessage(chatId, "❌ ভুল পাসওয়ার্ড দিলে কিন্তু চলবে না চাচা! 😴\nপাসওয়ার্ড ভুলে গেলে গুগল না, সোজা আলিফ ভাইয়ের কাছে মেসেজ দেন 📩\nবেশি না—মাত্র 5$ দিলেই ঝটপট চেঞ্জ করে দিবে 😂👍\n👉 @alifhosson", { reply_markup: getAdminMenuKeyboard() });
                delete user_states[userId];
            }
            return;
        }

        if (user_states[userId] === 'AWAITING_GITHUB_TOKEN') {
            const newToken = text.trim();
            try {
                await ConfigModel.findOneAndUpdate(
                    { key: "github_token" },
                    { value: newToken },
                    { upsert: true, new: true }
                );

                bot.sendMessage(chatId, "✅ **GitHub Token Saved Successfully!**\nSyncing system now...", { parse_mode: 'Markdown', reply_markup: getAdminMenuKeyboard() });
                syncSystem();
            } catch (e) {
                bot.sendMessage(chatId, "❌ Database Error saving token.", { reply_markup: getAdminMenuKeyboard() });
            }
            delete user_states[userId];
            return;
        }

        if (user_states[userId] === 'ADDING_NUMBER_STEP_1') {
            if (msg.document) {
                admin_file_buffer[userId] = { file_id: msg.document.file_id };
                user_states[userId] = 'ADDING_NUMBER_STEP_2';
                bot.sendMessage(chatId, "📂 **File Received!**\nCountry Name:", { parse_mode: 'Markdown' });
                return;
            } else {
                bot.sendMessage(chatId, "❌ Please send Excel file.", { reply_markup: getAdminMenuKeyboard(true) });
                return;
            }
        }
        if (user_states[userId] === 'ADDING_NUMBER_STEP_2') {
            if (text) {
                processUploadedFile(userId, admin_file_buffer[userId].file_id, text.trim());
                delete user_states[userId];
                delete admin_file_buffer[userId];
                return;
            }
        }
        if (user_states[userId] === 'BROADCASTING') {
            processBroadcast(msg);
            return;
        }
    }

    if (!text) return;

    if (text === '/start') {
        bot.sendMessage(chatId, "Welcome! Choose your option:", { reply_markup: getMainMenuKeyboard(userId) });
        
    // 🔄 /restart Command - Password চাইবে
    } else if (text === '/restart' && isAdmin(userId)) {
        user_states[userId] = 'AWAITING_PASS_FOR_RST';
        bot.sendMessage(chatId, "🔒 **Enter Restart Password:**", { 
            parse_mode: 'Markdown', 
            reply_markup: getAdminMenuKeyboard(true) 
        });
        
    } else if ((text === '🔑 Admin Menu' || text === '/admin') && isAdmin(userId)) {
        delete user_states[userId];
        bot.sendMessage(chatId, "🔑 **Admin Panel**", { parse_mode: 'Markdown', reply_markup: getAdminMenuKeyboard() });
        
    } else if (text === '➡️ Main Menu') {
        delete user_states[userId];
        bot.sendMessage(chatId, "Returning to Main Menu...", { reply_markup: getMainMenuKeyboard(userId) });
        
    } else if ((text === '/status' || text === '📊 Status') && isAdmin(userId)) {
        sendStatus(chatId);
        
    } else if (text === '🔑 Ass Token' && isAdmin(userId)) {
        user_states[userId] = 'AWAITING_PASS_FOR_TOKEN';
        bot.sendMessage(chatId, "🔒 **Enter Password:**", { reply_markup: getAdminMenuKeyboard(true) });
        
    } else if (text === '☎️ Support') {
        const markup = { inline_keyboard: [[{ text: "✉️ Contact Admin", url: `https://t.me/${SUPPORT_USERNAME}` }]] };
        bot.sendMessage(chatId, "☎️ Contact support:", { parse_mode: 'Markdown', reply_markup: markup });
        
    // 🔄 Restart Button (Admin Menu থেকে) - Password চাইবে
    } else if (text === '🔄 Restart' && isAdmin(userId)) {
        user_states[userId] = 'AWAITING_PASS_FOR_RST';
        bot.sendMessage(chatId, "🔒 **Enter Restart Password:**", { 
            parse_mode: 'Markdown', 
            reply_markup: getAdminMenuKeyboard(true) 
        });
            
    } else if (text === '➕ ADD' && isAdmin(userId)) {
        user_states[userId] = 'ADDING_NUMBER_STEP_1';
        bot.sendMessage(chatId, "➕ **Add Number**\nSend file.", { reply_markup: getAdminMenuKeyboard(true) });
        
    } else if (text === '📢 Broadcast' && isAdmin(userId)) {
        user_states[userId] = 'BROADCASTING';
        bot.sendMessage(chatId, "📢 **Broadcast**\nSend message.", { reply_markup: getAdminMenuKeyboard(true) });
        
    } else if (text === '🗑️ Delete' && isAdmin(userId)) {
        await rebuildCountryCache();
        const allCountries = getAllCountryList();
        if (Object.keys(allCountries).length === 0) {
            bot.sendMessage(chatId, "❌ Empty DB.", { reply_markup: getAdminMenuKeyboard() });
        } else {
            bot.sendMessage(chatId, "🗑️ **Delete:**", { parse_mode: 'Markdown', reply_markup: getDeleteCountryKeyboard() });
        }
        
    } else if (text === '📲 Get Number' || text === '🌍 Available Country') {
        handleNumberSelectionStart(userId, text);
        
    } else if (text === '✅ Active Number') {
        showActiveNumber(userId);
    }
});

// ===============================================
// 📌 END OF COMMAND HANDLER
// ===============================================

// ===============================================
// 📂 FILE PROCESSOR
// ===============================================
async function processUploadedFile(userId, fileId, inputName) {
    bot.sendMessage(userId, "⏳ **Processing (Smart Extract)...**");
    const rawName = inputName.trim();
    let flag = countryEmoji.flag(rawName) || "🌍";
    let countryName = countryEmoji.name(rawName) || rawName;

    try {
        const fileLink = await bot.getFileLink(fileId);
        request({ url: fileLink, encoding: null }, async (err, resp, buffer) => {
            if (err) { bot.sendMessage(userId, "❌ Error.", { reply_markup: getAdminMenuKeyboard() }); return; }
            try {
                const workbook = XLSX.read(buffer, { type: 'buffer' });
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

                let batchNumbers = [];
                let processedSet = new Set();

                jsonData.forEach(row => {
                    row.forEach(cell => {
                        if (cell) {
                            const cellText = String(cell);
                            const matches = cellText.match(/\d+/g);

                            if (matches) {
                                matches.forEach(num => {
                                    if (num.length >= 8) {
                                        if (!processedSet.has(num)) {
                                            processedSet.add(num);
                                            batchNumbers.push({
                                                number: num,
                                                country: countryName,
                                                flag: flag,
                                                status: 'Available'
                                            });
                                        }
                                    }
                                });
                            }
                        }
                    });
                });

                if (batchNumbers.length > 0) {
                    try {
                        const result = await NumberModel.insertMany(batchNumbers, { ordered: false });
                        await rebuildCountryCache();

                        const addedCount = result.length;

                        bot.sendMessage(userId, `✅ **Added Successfully!**\n📂 ${flag} ${countryName}\n🔢 Count: \`${addedCount}\``, { parse_mode: 'Markdown', reply_markup: getAdminMenuKeyboard() });

                        const currentTime = Date.now();
                        const sessionDuration = 30 * 60 * 1000;

                        if (currentTime - last_add_timestamp > sessionDuration) {
                            add_session_data = [];
                        }

                        add_session_data.push({
                            flag: flag,
                            country: countryName,
                            count: addedCount
                        });

                        last_add_timestamp = currentTime;

                        let notificationMsg = `✅ Fresh Number Added!\n`;

                        add_session_data.forEach(item => {
                            notificationMsg += `🌎 ${item.country} ${item.flag}\n`;
                            notificationMsg += `☎️ Count: ${item.count} ⚡\n`;
                        });

                        notificationMsg += `🚀 Traffic High. 🔥\n`;
                        notificationMsg += `🤖 @${bot_username}`;

                        for (const channel of REQUIRED_CHANNELS) {
                            const chatID = channel.id;
                            if (last_channel_msg_ids[chatID]) {
                                try { await bot.deleteMessage(chatID, last_channel_msg_ids[chatID]); } catch (e) { console.log("Del msg fail"); }
                            }
                            try {
                                const sentMsg = await bot.sendMessage(chatID, notificationMsg);
                                last_channel_msg_ids[chatID] = sentMsg.message_id;
                            } catch (e) { console.log("Send msg fail"); }
                        }

                    } catch (e) {
                        const count = e.insertedDocs ? e.insertedDocs.length : 0;
                        await rebuildCountryCache();
                        bot.sendMessage(userId, `⚠️ **Partial Add!**\nUnique Added: \`${count}\`\n(Duplicates ignored)`, { parse_mode: 'Markdown', reply_markup: getAdminMenuKeyboard() });
                    }
                } else {
                    bot.sendMessage(userId, `❌ No valid numbers found (Minimum 8 digits required).`, { reply_markup: getAdminMenuKeyboard() });
                }
            } catch (e) { bot.sendMessage(userId, `❌ File Read Error.`, { reply_markup: getAdminMenuKeyboard() }); }
        });
    } catch (e) { bot.sendMessage(userId, `❌ Process Error.`, { reply_markup: getAdminMenuKeyboard() }); }
}

async function processBroadcast(msg) {
    const userId = msg.from.id;
    const totalUsers = bot_users.size;
    
    const statusMsg = await bot.sendMessage(
        userId, 
        `📡 **Broadcasting to ${totalUsers}...**\n⏳ Estimated time: ${Math.ceil(totalUsers * 0.1)} seconds`, 
        { parse_mode: 'Markdown' }
    );

    let success = 0, fail = 0, blocked = 0;
    const usersArray = Array.from(bot_users);
    const batchSize = 20; // Process in batches

    for (let i = 0; i < usersArray.length; i += batchSize) {
        const batch = usersArray.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (targetId) => {
            if (ADMIN_IDS.includes(targetId)) return;
            
            try {
                await bot.copyMessage(targetId, msg.chat.id, msg.message_id);
                success++;
            } catch (e) {
                if (e.response && e.response.statusCode === 403) {
                    blocked++;
                    bot_users.delete(targetId); // Remove blocked users
                } else {
                    fail++;
                }
            }
        }));
        
        // Rate limit: 20 messages per second
        await new Promise(r => setTimeout(r, 1000));
        
        // Update progress every 100 users
        if (i % 100 === 0 && i > 0) {
            try {
                await safeEditMessage(
                    userId, 
                    statusMsg.message_id, 
                    `📡 **Broadcasting...**\n✅ Sent: ${success}\n❌ Failed: ${fail}\n🚫 Blocked: ${blocked}\n⏳ Progress: ${Math.round((i / totalUsers) * 100)}%`,
                    { parse_mode: 'Markdown' }
                );
            } catch (e) {}
        }
    }
    
    await safeEditMessage(
        userId,
        statusMsg.message_id,
        `✅ **Broadcast Complete!**\n🟢 Success: ${success}\n🔴 Failed: ${fail}\n🚫 Blocked: ${blocked}`,
        { parse_mode: 'Markdown', reply_markup: getAdminMenuKeyboard() }
    );
    
    delete user_states[userId];
    syncSystem(); // Sync after broadcast
}

async function sendStatus(chatId) {
    await rebuildCountryCache();
    const total = await NumberModel.countDocuments({});
    const avail = await NumberModel.countDocuments({ status: 'Available' });
    const users = bot_users.size;
    const mongoUsers = await UserModel.countDocuments({});

    const text = `🤖 **System Status**\n---\n👥 Users (Hybrid): \`${users}\`\n💾 Users (DB2): \`${mongoUsers}\`\n➡️ Numbers: \`${total}\`\n🟢 Available: \`${avail}\`\n🔴 Used: \`${total - avail}\`\n⚫ History: \`${await NumberModel.countDocuments({ status: 'Used_History' })}\``;

    bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: getAdminMenuKeyboard() });
}

// ===============================================
// 🟢 USER ACTIONS & CALLBACKS
// ===============================================
async function handleNumberSelectionStart(userId, text) {
    const { allowed, remaining } = isUserAllowedAction(userId);
    if (!allowed) { bot.sendMessage(userId, `Wait **${remaining}**s.`, { parse_mode: 'Markdown' }); return; }

    const currentNumber = await NumberModel.findOne({ assigned_to: userId, status: 'Used' });
    if (text === '📲 Get Number' && currentNumber) {
        bot.sendMessage(userId, `❌ You have an active number:\n${currentNumber.flag} \`${currentNumber.number}\``, { parse_mode: 'Markdown', reply_markup: getNumberControlKeyboard() });
        return;
    }

    await rebuildCountryCache();
    const availData = getAvailableCountriesData();
    if (Object.keys(availData).length === 0) { bot.sendMessage(userId, "Sorry! No numbers."); return; }

    const buttons = [];
    Object.keys(availData).sort().forEach(country => {
        buttons.push([{ 
            text: `${availData[country].flag} ${country} (${availData[country].count})`, 
            callback_data: `assign_number:${countryToIndex[country]}`
        }]);
    });
    bot.sendMessage(userId, "🌍 **Select Country:**", { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
}

async function showActiveNumber(userId) {
    const data = await NumberModel.findOne({ assigned_to: userId, status: 'Used' });
    if (data) {
        bot.sendMessage(userId, `✅ **Active Number**\n${data.flag} ${data.country}\n\`${data.number}\``, { parse_mode: 'Markdown', reply_markup: getNumberControlKeyboard() });
    } else {
        bot.sendMessage(userId, "❌ No active number.", { parse_mode: 'Markdown' });
    }
}


// 🔥 OPTIMIZED CALLBACK HANDLER (HIGH CONCURRENCY + TIMEOUT FIX)
bot.on('callback_query', async (call) => {
    const userId = call.from.id;
    const data = call.data;
    const msgId = call.message.message_id;
    const chatId = call.message.chat.id;

    // ❌ REMOVED: Global safeAnswerCallback এখান থেকে সরিয়েছি।
    // কারণ এটা শুরুতে থাকলে নিচের 'show_alert' কাজ করবে না।

    if (data === 'verify_check') {
        if (await isUserMember(userId)) {
            await safeAnswerCallback(call.id); // ✅ Here
            await safeEditMessage(chatId, msgId, "✅ Verification Successful!\nWelcome to our platform.\nEnjoy a smooth and secure experience.");
            bot.sendMessage(userId, "Menu:", { reply_markup: getMainMenuKeyboard(userId) });
        } else {
            // ⚠️ Alert needs direct answer
            try {
                await bot.answerCallbackQuery(call.id, { text: "❌ Join channels!", show_alert: true });
            } catch (e) {}
        }
        return;
    }

    if (data === 'cancel_delete' && isAdmin(userId)) {
        await safeAnswerCallback(call.id); // ✅ Here
        await safeEditMessage(chatId, msgId, "✅ Cancelled.");
        bot.sendMessage(userId, "Menu:", { reply_markup: getAdminMenuKeyboard() });
        return;
    }

    if (data.startsWith('sdc:') && isAdmin(userId)) {
        await safeAnswerCallback(call.id); // ✅ Here
        const countryIdx = parseInt(data.split(':')[1]);
        const country = indexToCountry[countryIdx];
        admin_country_temp_data[userId] = country;
        const count = await NumberModel.countDocuments({ country: country });
        const markup = {
            inline_keyboard: [
                [{ text: `✅ DELETE ALL (${count})`, callback_data: `cdc:${countryIdx}` }],
                [{ text: "❌ CANCEL", callback_data: 'cancel_delete' }]
            ]
        };
        await safeEditMessage(chatId, msgId, `⚠️ Delete **${country}**?`, { parse_mode: 'Markdown', reply_markup: markup });
        return;
    }

    if (data.startsWith('cdc:') && isAdmin(userId)) {
        await safeAnswerCallback(call.id); // ✅ Here
        const countryIdx = parseInt(data.split(':')[1]);
        const country = indexToCountry[countryIdx];
        if (admin_country_temp_data[userId] !== country) return;

        try {
            await bot.deleteMessage(chatId, msgId);
        } catch (e) {
            console.log("Message delete failed or already deleted");
        }

        bot.sendMessage(userId, "⏳ **Backing up FRESH numbers & Deleting...**");

        try {
            const freshNumbers = await NumberModel.find({ country: country, status: 'Available' });

            if (freshNumbers.length > 0) {
                let fileContent = "";
                freshNumbers.forEach(item => {
                    fileContent += `${item.number}\n`;
                });

                const fileBuffer = Buffer.from(fileContent, 'utf8');
                const fileName = `${country.replace(/\s/g, '_')}_Fresh_Backup.txt`;

                for (const adminId of ADMIN_IDS) {
                    try {
                        await bot.sendDocument(adminId, fileBuffer, {
                            caption: `🗑️ **Country Deleted: ${country}**\n👤 Action by: ${userId}\n📂 Backup of Fresh Numbers: ${freshNumbers.length}\n(Used numbers are ignored)`
                        }, {
                            filename: fileName,
                            contentType: 'text/plain'
                        });
                    } catch (err) {
                        console.log(`Failed to send backup to admin ${adminId}:`, err.message);
                    }
                }
            } else {
                bot.sendMessage(userId, "⚠️ No fresh numbers found to backup (All used or empty).");
            }

            const result = await NumberModel.deleteMany({ country: country });
            await rebuildCountryCache();

            bot.sendMessage(userId, `✅ **Success!**\nDeleted Total: ${result.deletedCount} numbers from DB.`, { reply_markup: getAdminMenuKeyboard() });

        } catch (error) {
            console.error("Delete Error:", error);
            bot.sendMessage(userId, "❌ Error during process.", { reply_markup: getAdminMenuKeyboard() });
        }
        return;
    }

    if (!isAdmin(userId) && !(await isUserMember(userId))) return;
    
    // Check Action Allowance
    const { allowed, remaining } = isUserAllowedAction(userId);
    if (!allowed) { 
        try {
            await bot.answerCallbackQuery(call.id, { text: `Wait ${remaining}s`, show_alert: true });
        } catch(e) {}
        return; 
    }

    // 🔥 ASSIGN NUMBER
    if (data.startsWith('assign_number:')) {
        await safeAnswerCallback(call.id); // ✅ Here to stop loading
        const countryIdx = parseInt(data.split(':')[1]);
        const country = indexToCountry[countryIdx];

        await safeEditMessage(chatId, msgId, "⏳ **Assigning number...**", { parse_mode: 'Markdown' });

        if (!country_assignment_locks[country]) {
            country_assignment_locks[country] = new Set();
        }

        if (country_assignment_locks[country].has(userId)) {
            return;
        }

        country_assignment_locks[country].add(userId);

        try {
            await NumberModel.updateMany(
                { assigned_to: userId, status: 'Used' }, 
                { $set: { status: 'Used_History', assigned_to: null, assigned_at: null } }
            );

            const availableNumbers = await NumberModel.aggregate([
                { $match: { country: country, status: 'Available' } },
                { $sample: { size: 1 } }
            ]);

            if (availableNumbers.length > 0) {
                const randomNum = await NumberModel.findByIdAndUpdate(
                    availableNumbers[0]._id,
                    { $set: { status: 'Used', assigned_to: userId, assigned_at: new Date() } },
                    { new: true }
                );

                let displayNum = randomNum.number.startsWith('+') ? randomNum.number : '+' + randomNum.number;
                await safeEditMessage(chatId, msgId, 
                    ASSIGNMENT_MESSAGE_TEMPLATE(randomNum.flag, randomNum.country, displayNum, "Assigned", NEW_FOOTER_QUOTE),
                    { parse_mode: 'HTML', reply_markup: getNumberControlKeyboard() }
                );
            } else {
                await rebuildCountryCache();
                await safeEditMessage(chatId, msgId, `❌ Sold Out.`);
            }
        } finally {
            country_assignment_locks[country].delete(userId);
        }
    }

    // 🔥 CHANGE NUMBER WITH COOLDOWN (FIXED)
    else if (data === 'change_number_req') {
        const currentTime = Date.now() / 1000;
        const lastTime = last_change_time[userId] || 0;
        const timeDiff = currentTime - lastTime;
        const cooldownTime = 3;

        // ✅ CHECK COOLDOWN FIRST (Before Answering)
        if (timeDiff < cooldownTime) {
            const remainingAlert = Math.ceil(cooldownTime - timeDiff);
            try {
                await bot.answerCallbackQuery(call.id, { 
                    text: `⏳ Wait ${remainingAlert} second${remainingAlert > 1 ? 's' : ''}!`, 
                    show_alert: true 
                });
            } catch (e) {
                // If answer fails, user likely double-clicked very fast
            }
            return;
        }

        // ✅ COOLDOWN PASSED - NOW ANSWER
        await safeAnswerCallback(call.id);
        last_change_time[userId] = currentTime;

        // Optimized Animation (No setInterval to avoid hang)
        try {
            await safeEditMessage(chatId, msgId, "🔄 <b>Changing Number...</b>\n┏━━━━━━━━━━━━┓\n⬇️ Finding fresh line...", { parse_mode: 'HTML' });
        } catch(e) {}

        // Immediate Execution (No artificial delay)
        const current = await NumberModel.findOne({ assigned_to: userId, status: 'Used' });

        if (current) {
            const country = current.country;

            if (!country_assignment_locks[country]) {
                country_assignment_locks[country] = new Set();
            }

            if (country_assignment_locks[country].has(userId)) {
                return;
            }

            country_assignment_locks[country].add(userId);

            try {
                const [_, availableNumbers] = await Promise.all([
                    NumberModel.updateOne(
                        { _id: current._id },
                        { $set: { status: 'Used_History', assigned_to: null, assigned_at: null } }
                    ),
                    NumberModel.aggregate([
                        { $match: { country: country, status: 'Available' } },
                        { $sample: { size: 1 } }
                    ])
                ]);

                if (availableNumbers.length > 0) {
                    const newNumber = await NumberModel.findByIdAndUpdate(
                        availableNumbers[0]._id,
                        { $set: { status: 'Used', assigned_to: userId, assigned_at: new Date() } },
                        { new: true }
                    );

                    let displayNum = newNumber.number.startsWith('+') ? newNumber.number : '+' + newNumber.number;
                    await safeEditMessage(chatId, msgId, 
                        ASSIGNMENT_MESSAGE_TEMPLATE(newNumber.flag, newNumber.country, displayNum, "Changed", NEW_FOOTER_QUOTE),
                        { parse_mode: 'HTML', reply_markup: getNumberControlKeyboard() }
                    );
                } else {
                    await safeEditMessage(chatId, msgId, `❌ No numbers left in ${country}.`, {
                        reply_markup: { inline_keyboard: [[{ text: "🌍 Change Country", callback_data: 'change_country_start' }]] }
                    });
                }
            } catch (e) {
                console.error(e);
            } finally {
                country_assignment_locks[country].delete(userId);
            }
        } else {
            await safeEditMessage(chatId, msgId, "❌ No active number.");
        }
    }

    else if (data === 'change_country_start') {
        await safeAnswerCallback(call.id); // ✅ Here
        await NumberModel.updateMany(
            { assigned_to: userId, status: 'Used' }, 
            { $set: { status: 'Used_History', assigned_to: null, assigned_at: null } }
        );
        await rebuildCountryCache();
        const availData = getAvailableCountriesData();
        const buttons = [];

        Object.keys(availData).sort().forEach(c => {
            buttons.push([{ 
                text: `${availData[c].flag} ${c} (${availData[c].count})`, 
                callback_data: `assign_number:${countryToIndex[c]}`
            }]);
        });

        await safeEditMessage(chatId, msgId, "🌍 **Select New Country:**", { 
            parse_mode: 'Markdown', 
            reply_markup: { inline_keyboard: buttons } 
        });
    }
});


setInterval(() => {
    const oneHourAgo = Date.now() - 3600000;
    let cleaned = 0;
    
    Object.keys(user_details_cache).forEach(key => {
        if (user_details_cache[key]?.timestamp < oneHourAgo) {
            delete user_details_cache[key];
            cleaned++;
        }
    });
    
    Object.keys(country_assignment_locks).forEach(country => {
        if (country_assignment_locks[country].size === 0) {
            delete country_assignment_locks[country];
        }
    });
    
    if (cleaned > 0) console.log(`🧹 Cleaned ${cleaned} cache entries`);
}, 30 * 60 * 1000);

// ===============================================
// 📴 GRACEFUL SHUTDOWN
// ===============================================
process.on('SIGTERM', async () => {
    console.log('📴 Shutting down...');
    bot.stopPolling();
    await numberConn.close();
    await userConn.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('📴 SIGINT received...');
    bot.stopPolling();
    await numberConn.close();
    await userConn.close();
    process.exit(0);
});

// Start Sync
try {
    if (fs.existsSync(USER_LIST_FILE)) {
        bot_users = new Set(JSON.parse(fs.readFileSync(USER_LIST_FILE)));
    }
} catch (e) {}

console.log("🚀 Bot is running...");
