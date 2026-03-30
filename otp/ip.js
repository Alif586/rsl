const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const crypto = require('crypto');

const binance = express();

// ✅ কনফিগারেশন
const CONFIG = {
    BINANCE_API_KEY: 'SVEucScvmaN2j99yZN3XNIr4GRrxkMSZ6oC98MPMiomFfHhNLRcClXyXW94bIJuO',
    BINANCE_API_SECRET: 'kRl81H9ANzrYCIsCOzfVRtT99Xc5E76uU1cwRnRfwhxHDHNpTElbdczNnXswtF75',
    MONGO_URI: 'mongodb+srv://sabbirrehman905_db_user:sabbir123@userjson.f0vppgx.mongodb.net/UserDB?appName=Userjson',
    PORT: 3000
};

// ১. ডাটাবেজ মডেল (Double Spending Protection)
const TransactionSchema = new mongoose.Schema({
    txId: { type: String, unique: true, required: true },
    payerName: String,
    payerEmail: String,
    payerBinanceId: String,
    amount: Number,
    currency: String,
    status: String,
    date: { type: Date, default: Date.now }
});

// ✅ TTL Index: 30 দিন পর automatically delete হবে
TransactionSchema.index({ date: 1 }, { expireAfterSeconds: 2592000 });

const Transaction = mongoose.model('Transaction', TransactionSchema);

/**
 * ২. বাইনান্স সিগনেচার তৈরির ফাংশন
 */
function generateSignature(queryString, secret) {
    return crypto
        .createHmac('sha256', secret)
        .update(queryString)
        .digest('hex');
}

/**
 * ৩. পেমেন্ট ভেরিফাই করার GET এন্ডপয়েন্ট
 * ব্যবহার: /api/verify-payment?txId=423188230224076800&expectedAmount=0.01
 */
binance.get('/api/verify-payment', async (req, res) => {
    const { txId, expectedAmount } = req.query;

    if (!txId) {
        return res.status(400).json({ success: false, message: "txId (Order ID) প্রয়োজন।" });
    }

    try {
        // ক. ডাটাবেজে চেক: এই Order ID আগে ব্যবহার হয়েছে কি না
        const existingTx = await Transaction.findOne({ txId });
        if (existingTx) {
            return res.status(400).json({ success: false, message: "এই Order ID টি আগেই ব্যবহার করা হয়েছে!" });
        }

        // ✅ FIX 1: startTime ও endTime যোগ করা — না দিলে Binance data দেয় না
        const timestamp = Date.now();
        const startTime = timestamp - (90 * 24 * 60 * 60 * 1000); // শেষ ৯০ দিন
        const queryString = `startTime=${startTime}&endTime=${timestamp}&timestamp=${timestamp}`;
        const signature = generateSignature(queryString, CONFIG.BINANCE_API_SECRET);

        const response = await axios.get(
            `https://api.binance.com/sapi/v1/pay/transactions?${queryString}&signature=${signature}`,
            {
                headers: { 'X-MBX-APIKEY': CONFIG.BINANCE_API_KEY },
                timeout: 10000
            }
        );

        // ✅ FIX 2: Binance response status চেক
        const responseData = response.data;
        if (!responseData || (responseData.status !== '0' && responseData.code !== '000000')) {
            console.error("Binance API Response:", responseData);
            return res.status(500).json({
                success: false,
                message: "Binance API থেকে সঠিক response আসেনি।",
                binanceError: responseData?.errorMessage || responseData?.msg || 'Unknown error'
            });
        }

        const transactions = responseData.data || [];

        // ✅ FIX 3: orderId এর পাশাপাশি merchantTradeNo ও চেক করা
        const match = transactions.find(t =>
            t.orderId === txId ||
            t.merchantTradeNo === txId
        );

        if (match) {
            // ✅ FIX 4: Binance Pay-এ amount field হলো transAmount
            const receivedAmount = parseFloat(match.transAmount || match.amount || 0);

            if (expectedAmount && receivedAmount < parseFloat(expectedAmount)) {
                return res.status(400).json({
                    success: false,
                    message: `টাকার পরিমাণ সঠিক নয়। পাওয়া গেছে: ${receivedAmount}, প্রত্যাশিত: ${expectedAmount}`
                });
            }

            // ✅ FIX 5: fundsDetail একটি array — সঠিকভাবে access করা
            const payerInfo = {
                name: match.payerInfo?.name
                    || (Array.isArray(match.fundsDetail) ? match.fundsDetail[0]?.name : match.fundsDetail?.name)
                    || 'N/A',
                email: match.payerInfo?.email || 'N/A',
                binanceId: match.payerInfo?.binanceId || match.openUserId || 'N/A'
            };

            // ঘ. ডাটাবেজে সেভ
            await Transaction.create({
                txId: match.orderId || txId,
                payerName: payerInfo.name,
                payerEmail: payerInfo.email,
                payerBinanceId: payerInfo.binanceId,
                amount: receivedAmount,
                currency: match.currency || match.cryptoCurrency || 'USDT',
                status: 'verified',
                date: new Date()
            });

            return res.json({
                success: true,
                message: "Binance Pay Verified Successfully!",
                data: {
                    orderId: match.orderId || txId,
                    amount: receivedAmount,
                    currency: match.currency || match.cryptoCurrency || 'USDT',
                    payer: {
                        name: payerInfo.name,
                        email: payerInfo.email,
                        binanceId: payerInfo.binanceId
                    }
                }
            });

        } else {
            console.log("Available Order IDs:", transactions.map(t => t.orderId));
            return res.status(404).json({
                success: false,
                message: "বাইনান্স পে ট্রানজেকশনটি পাওয়া যায়নি।",
                hint: `মোট ${transactions.length}টি transaction পাওয়া গেছে। Order ID টি সঠিক কিনা চেক করুন।`
            });
        }

    } catch (error) {
        // ✅ FIX 6: বিস্তারিত error response
        if (error.response) {
            console.error("Binance API Error:", error.response.status, error.response.data);
            return res.status(500).json({
                success: false,
                message: "Binance API Error",
                details: error.response.data
            });
        } else if (error.code === 'ECONNABORTED') {
            return res.status(500).json({ success: false, message: "Binance API timeout। আবার চেষ্টা করুন।" });
        } else {
            console.error("Server Error:", error.message);
            return res.status(500).json({ success: false, message: "Internal Server Error", error: error.message });
        }
    }
});

// ৪. সার্ভার এবং ডাটাবেজ কানেক্ট
mongoose.connect(CONFIG.MONGO_URI)
    .then(() => {
        console.log("✅ MongoDB Connected");
        binance.listen(CONFIG.PORT, () => {
            console.log(`✅ Binance Server running on port ${CONFIG.PORT}`);
        });
    })
    .catch(err => {
        console.error("❌ MongoDB Connection Error:", err.message);
    });

module.exports = binance;
