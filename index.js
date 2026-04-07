const fs = require('fs');
const path = require('path');
const TelegramBot = require("node-telegram-bot-api");

// ============================================================
// ⚙️ ADMIN CONFIGURATION
// ============================================================
const ADMIN_IDS = ["6006322754", "6135656510", "1817149496"];

// ============================================================
// 🤖 BOT CONFIGURATION
// ============================================================
const BOT_TOKENS = {
    NOTIFICATION_BOT: "8658998311:AAG9-3f-j6gnv5uVhtugmtUnPwoBZI6IZVk", // Bot 1
    USER_BOT: "8499409386:AAE7w7F61I3PBGY8NwGYE7xEcaSrEW8n6Yw"         // Bot 2
};

const GROUP_LINKS = {
    OTP_GROUP_ID: "-1003748109602",
     MAIN_CHANNEL_LINK: "https://t.me/User_Support_2026",
    NUMBER_PANEL_LINK: "https://t.me/OTP_Fast7_Bot"
};

// ============================================================
// 🗄️ MONGODB CONFIGURATION
// ============================================================
const USER_DB_URI = "mongodb+srv://mdrasel666699990_db_user:Rasel123@user.xiwhpml.mongodb.net/UserDB?appName=User";
const NUMBER_DB_URI = "mongodb+srv://bangladesh900200_db_user:Rasel123@number.kfxm7hy.mongodb.net/Number?retryWrites=true&w=majority";

// ============================================================
// 🎨 LOGGING SYSTEM
// ============================================================
const colors = {
    reset: "\x1b[0m", bright: "\x1b[1m", green: "\x1b[32m",
    yellow: "\x1b[33m", cyan: "\x1b[36m", red: "\x1b[31m", blue: "\x1b[34m"
};

function log(source, msg, type = 'info') {
    let color = colors.green, icon = "🔹";
    if (type === 'error') { color = colors.red; icon = "❌"; }
    else if (type === 'sms') { color = colors.cyan; icon = "📩"; }
    else if (type === 'warn') { color = colors.yellow; icon = "⚠️"; }
    else if (type === 'success') { color = colors.green; icon = "✅"; }

    console.log(`${colors.bright}${color}${icon} [${source}]${colors.reset} ${msg}`);
}

// ============================================================
// 📢 ERROR REPORTING
// ============================================================
let adminBot = null;

async function initAdminBot() {
    try {
        adminBot = new TelegramBot(BOT_TOKENS.USER_BOT, { polling: false });
        log("SYSTEM", `Admin reporting enabled for ${ADMIN_IDS.length} admins`, "success");
    } catch (e) {
        console.error("Failed to init admin bot:", e.message);
    }
}

async function reportErrorToAdmin(source, errorMessage) {
    if (!adminBot || ADMIN_IDS.length === 0) return;
    const text = `❌ <b>ERROR ALERT</b>\n\n📍 <b>Source:</b> ${source}\n⚠️ <b>Error:</b>\n<pre>${String(errorMessage).substring(0, 3000)}</pre>`;

    for (const adminId of ADMIN_IDS) {
        try {
            await adminBot.sendMessage(adminId, text, { parse_mode: "HTML" });
        } catch (e) {
            // Ignore if admin blocked bot
        }
    }
}

// ============================================================
// 🚀 LOADERS
// ============================================================
function loadNumberBot() {
    const numberBotPath = path.join(__dirname, 'Number', 'number-bot.js');
    if (!fs.existsSync(numberBotPath)) {
        log("SYSTEM", "Number Bot file missing!", "error");
        return;
    }
    try {
        global.NUMBER_BOT_CONFIG = {
            BOT_TOKEN: BOT_TOKENS.USER_BOT,
            USER_DB_URI: USER_DB_URI,
            NUMBER_DB_URI: NUMBER_DB_URI,
            OTP_GROUP_URL: GROUP_LINKS.MAIN_CHANNEL_LINK
        };
        require(numberBotPath);
        log("NUMBER-BOT", "Started Successfully!", "success");
    } catch (error) {
        reportErrorToAdmin("NUMBER BOT LOAD", error.message);
    }
}

function loadOtpWorkers() {
    const otpFolder = path.join(__dirname, 'otp');
    if (!fs.existsSync(otpFolder)) fs.mkdirSync(otpFolder, { recursive: true });

    const files = fs.readdirSync(otpFolder).filter(file => file.endsWith('.js'));
    if (files.length === 0) return log("SYSTEM", "No OTP workers found.", "warn");

    files.forEach(file => {
        const workerName = file.replace('.js', '').toUpperCase();
        try {
            log("SYSTEM", `Loading Worker: ${workerName}...`, "warn");
            const WorkerClass = require(path.join(otpFolder, file));
            const worker = new WorkerClass();

            worker.setConfig({ BOT_TOKENS, GROUP_LINKS, NUMBER_DB_URI });

            worker.on('log', (msg) => log(workerName, msg, 'info'));
            worker.on('error', (msg) => {
                log(workerName, msg, 'error');
                // Optional: Reduce admin spam by uncommenting below only for critical errors
                // reportErrorToAdmin(workerName, msg); 
            });
            worker.on('sms', (msg) => log(workerName, msg, 'sms'));

            worker.start();
        } catch (error) {
            log(workerName, `Load Error: ${error.message}`, "error");
        }
    });
}

// ============================================================
// ⚠️ GLOBAL HANDLERS
// ============================================================
process.on('uncaughtException', (err) => {
    console.error('💥 Uncaught:', err.message);
    reportErrorToAdmin("SYSTEM CRASH", err.message);
});

process.on('unhandledRejection', (reason) => {
    console.error('💥 Rejection:', reason);
});

// ============================================================
// 🏁 START
// ============================================================
(async () => {
    console.log(`\n🤖 MULTI-BOT SYSTEM STARTING\n`);
    await initAdminBot();
    loadNumberBot();
    loadOtpWorkers();
})();
