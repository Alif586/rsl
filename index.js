const fs = require('fs');
const path = require('path');
const TelegramBot = require("node-telegram-bot-api");

// ============================================================
// ⚙️ ADMIN CONFIGURATION
// ============================================================
const ADMIN_IDS = ["6006322754, 1817149496"];


// ============================================================
// 🤖 BOT CONFIGURATION
// ============================================================
const BOT_TOKENS = {
    // User Bot (Number Bot)
    USER_BOT: "8499409386:AAHbvjiq00IP2y2FQEkK9pUYIH_8K1tASUI"
};

// ============================================================
// 🗄️ MONGODB CONFIGURATION
// ============================================================
// Number Bot এর জন্য USER_DB_URI
const USER_DB_URI = "mongodb+srv://mdrasel666699990_db_user:Rasel123@user.xiwhpml.mongodb.net/UserDB?appName=User";

// OTP Workers এর জন্য NUMBER_DB_URI
const NUMBER_DB_URI = "mongodb+srv://bangladesh900200_db_user:Rasel123@number.kfxm7hy.mongodb.net/Number?retryWrites=true&w=Number";

// ============================================================
// 🎨 LOGGING SYSTEM (Time Removed)
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
// 📢 ERROR REPORTING TO ADMINS
// ============================================================
let adminBot = null;

async function initAdminBot() {
    try {
        adminBot = new TelegramBot(BOT_TOKENS.USER_BOT, { polling: false });
        log("SYSTEM", `Admin error reporting enabled for ${ADMIN_IDS.length} admins!`, "success");
    } catch (e) {
        console.error("Failed to init admin bot:", e.message);
    }
}

async function reportErrorToAdmin(source, errorMessage) {
    if (!adminBot || ADMIN_IDS.length === 0) return;

    const text = `❌ <b>ERROR ALERT</b>\n\n📍 <b>Source:</b> ${source}\n⚠️ <b>Error:</b>\n<pre>${errorMessage.substring(0, 3000)}</pre>`;

    for (const adminId of ADMIN_IDS) {
        try {
            await adminBot.sendMessage(adminId, text, { parse_mode: "HTML" });
            log("ADMIN-NOTIFY", `Error report sent to admin ${adminId}`, "success");
        } catch (e) {
            console.error(`${colors.red}Failed to send error to admin ${adminId}: ${e.message}${colors.reset}`);
        }
    }
}

// ============================================================
// 🚀 LOAD NUMBER BOT
// ============================================================
function loadNumberBot() {
    const numberBotPath = path.join(__dirname, 'Number', 'number-bot.js');

    if (!fs.existsSync(numberBotPath)) {
        const errMsg = "❌ Number Bot file not found at: Number/number-bot.js";
        log("SYSTEM", errMsg, "error");
        reportErrorToAdmin("NUMBER BOT LOADER", errMsg);
        return;
    }

    try {
        log("SYSTEM", "Loading Number Bot...", "warn");

        // Number Bot কে config pass করা
        global.NUMBER_BOT_CONFIG = {
            BOT_TOKEN: BOT_TOKENS.USER_BOT,
            USER_DB_URI: USER_DB_URI,
            NUMBER_DB_URI: NUMBER_DB_URI
        };

        require(numberBotPath);
        log("NUMBER-BOT", "Started Successfully!", "success");
    } catch (error) {
        const errMsg = `Critical Load Error: ${error.message}\n${error.stack}`;
        log("NUMBER-BOT", errMsg, "error");
        reportErrorToAdmin("NUMBER BOT LOAD", errMsg);
    }
}

// ============================================================
// ⚠️ GLOBAL ERROR CATCHING
// ============================================================
process.on('uncaughtException', (err) => {
    console.error('💥 Uncaught Exception:', err);
    reportErrorToAdmin("SYSTEM CRASH", `Uncaught Exception:\n${err.message}\n${err.stack}`);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection:', reason);
    reportErrorToAdmin("PROMISE REJECTION", `Unhandled Rejection:\n${reason}`);
});

// ============================================================
// 🚀 START SYSTEM
// ============================================================
async function startSystem() {
    console.log(`
╔════════════════════════════════════╗
║   🤖 NUMBER BOT SYSTEM STARTING   ║
║   👨‍💻 Developer: Alif Hosson        ║
╚════════════════════════════════════╝
    `);

    await initAdminBot();

    log("SYSTEM", "Loading Number Bot...", "warn");
    loadNumberBot();

    log("SYSTEM", "Number Bot System Running! 🚀", "success");
}

startSystem();