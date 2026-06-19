import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const design = `❂═⚌═══⏣═══⚌═❂
⤾〔 لعبة المارد الأزرق 〕⤿
❂═⚌═══⏣═══⚌═❂`;

const designEnd = `❂═⚌═══⏣═══⚌═❂
☞ ⤿𝑵𝑨𝑮𝑼𝑴𝑶 ⤾`;

const STATIC_IMAGE = path.join(__dirname, '..', 'media', 'akinator.jpg');

function getStaticImage() {
    try {
        return fs.readFileSync(STATIC_IMAGE);
    } catch (error) {
        console.error('خطأ في قراءة الصورة:', error);
        return null;
    }
}

// تخزين الجلسات والإحصائيات بشكل عام (global) لأنه مش متاح sock.aki هنا
if (!global.aki) global.aki = {};
if (!global.gameStats) global.gameStats = {};

let handler = async (m, { conn, usedPrefix, command, args }) => {
    const jid = m.chat;
    const sender = m.sender;
    const senderName = m.pushName || 'لاعب';

    const sessionKey = `${jid}-${sender}`;
    const session = global.aki[sessionKey];

    const text = (args.join(' ') || '').trim().toLowerCase();

    // ========== معالجة الإجابات ==========
    if (text) {
        if (text === 'نعم') {
            if (!session) return sendNoSession(conn, jid, m, usedPrefix);
            return await processAnswer(conn, jid, session, sessionKey, sender, senderName, 0, m);
        }

        if (text === 'لا') {
            if (!session) return sendNoSession(conn, jid, m, usedPrefix);
            return await processAnswer(conn, jid, session, sessionKey, sender, senderName, 1, m);
        }

        if (text === 'لا أعرف' || text === 'لا اعرف') {
            if (!session) return sendNoSession(conn, jid, m, usedPrefix);
            return await processAnswer(conn, jid, session, sessionKey, sender, senderName, 2, m);
        }

        if (text === 'ربما') {
            if (!session) return sendNoSession(conn, jid, m, usedPrefix);
            return await processAnswer(conn, jid, session, sessionKey, sender, senderName, 3, m);
        }

        if (text === 'ربما لا') {
            if (!session) return sendNoSession(conn, jid, m, usedPrefix);
            return await processAnswer(conn, jid, session, sessionKey, sender, senderName, 4, m);
        }

        if (text === 'رجوع') {
            if (!session) return sendNoSession(conn, jid, m, usedPrefix);
            return await goBack(conn, jid, session, sessionKey, m, senderName);
        }

        if (text === 'حذف') {
            if (!session) {
                return conn.sendMessage(jid, {
                    text: `${design}\n\n❌ لا توجد جلسة نشطة.\n\n${designEnd}`
                }, { quoted: m });
            }
            delete global.aki[sessionKey];
            return conn.sendMessage(jid, {
                text: `${design}\n\n🗑️ تم حذف الجلسة بنجاح.\n\n${designEnd}`
            }, { quoted: m });
        }

        if (text === 'مساعدة' || text === 'help') {
            const helpText = `${design}\n\n📘 *شرح لعبة المارد الأزرق*\n\n🧞 المارد هيحاول يخمن الشخص اللي في بالك!\n\n*الأوامر:*\n\n🎮 *${usedPrefix}${command}* - بدء اللعبة\n✅ *${usedPrefix}${command} نعم* - إجابة بنعم\n❌ *${usedPrefix}${command} لا* - إجابة بلا\n❓ *${usedPrefix}${command} لا أعرف* - مش متأكد\n🤔 *${usedPrefix}${command} ربما* - احتمال نعم\n😕 *${usedPrefix}${command} ربما لا* - احتمال لا\n🔙 *${usedPrefix}${command} رجوع* - الرجوع للسؤال السابق\n🗑️ *${usedPrefix}${command} حذف* - حذف الجلسة\n\n${designEnd}`;

            return conn.sendMessage(jid, { text: helpText }, { quoted: m });
        }
    }

    // ========== بدء اللعبة ==========
    if (session) {
        return conn.sendMessage(jid, {
            text: `${design}\n\n🎮 *لديك جلسة نشطة بالفعل!*\n\nاستمر في الإجابة على الأسئلة.\n\n• ${usedPrefix}${command} نعم / لا\n• ${usedPrefix}${command} رجوع\n• ${usedPrefix}${command} حذف\n\n${designEnd}`
        }, { quoted: m });
    }

    try {
        if (!global.gameStats[sender]) {
            global.gameStats[sender] = {
                totalGames: 0,
                totalQuestions: 0,
                wins: 0
            };
        }

        global.gameStats[sender].currentGame = {
            startTime: Date.now(),
            questionsCount: 0,
            attempts: 0
        };

        const response = await axios.post('https://mr-obito-api.vercel.app/api/akinator_start');
        const data = response.data;

        if (!data.session || !data.signature) {
            return conn.sendMessage(jid, {
                text: `${design}\n\n❌ فشل بدء الجلسة. حاول مرة أخرى.\n\n${designEnd}`
            }, { quoted: m });
        }

        global.aki[sessionKey] = {
            session: data.session,
            signature: data.signature,
            step: 0,
            progression: 0,
            questionsCount: 0
        };

        return await sendQuestion(conn, jid, data.question, m, usedPrefix, command);
    } catch (err) {
        console.error('خطأ في بدء اللعبة:', err);
        return conn.sendMessage(jid, {
            text: `${design}\n\n⚠️ حدث خطأ أثناء بدء اللعبة، حاول مرة أخرى.\n\n${designEnd}`
        }, { quoted: m });
    }
};

function sendNoSession(conn, jid, m, usedPrefix) {
    return conn.sendMessage(jid, {
        text: `${design}\n\n❌ لا توجد جلسة نشطة. ابدأ لعبة جديدة بـ ${usedPrefix}مارد\n\n${designEnd}`
    }, { quoted: m });
}

// دالة معالجة الإجابة
async function processAnswer(conn, jid, session, sessionKey, sender, senderName, answerValue, m) {
    try {
        global.aki[sessionKey].questionsCount = (global.aki[sessionKey].questionsCount || 0) + 1;
        if (global.gameStats[sender]?.currentGame) {
            global.gameStats[sender].currentGame.questionsCount++;
        }

        const response = await axios.post('https://mr-obito-api.vercel.app/api/akinator_answer', {
            session: session.session,
            signature: session.signature,
            step: session.step,
            progression: session.progression,
            answer: answerValue,
            cm: "false",
            sid: "NaN",
            question_filter: "string"
        });

        const data = response.data;

        // إذا وصلنا لنتيجة (خمن الشخصية)
        if (data.name_proposition) {
            const questionsCount = global.aki[sessionKey].questionsCount || 0;
            const gameTime = global.gameStats[sender]?.currentGame?.startTime ?
                Math.round((Date.now() - global.gameStats[sender].currentGame.startTime) / 1000) : 0;

            if (global.gameStats[sender]) {
                global.gameStats[sender].totalGames = (global.gameStats[sender].totalGames || 0) + 1;
                global.gameStats[sender].totalQuestions = (global.gameStats[sender].totalQuestions || 0) + questionsCount;
                global.gameStats[sender].wins = (global.gameStats[sender].wins || 0) + 1;
                delete global.gameStats[sender].currentGame;
            }

            let resultMessage = `${design}\n\n`;
            resultMessage += `🧞 *المارد خمن شخصيتك!*\n\n`;
            resultMessage += `━━━━━━━━━━━━━━━━━━━━\n`;
            resultMessage += `👤 *الشخصية:* ${data.name_proposition}\n`;
            resultMessage += `📝 *نبذة:* ${data.description_proposition || 'لا توجد معلومات إضافية'}\n`;
            resultMessage += `━━━━━━━━━━━━━━━━━━━━\n`;
            resultMessage += `📊 *إحصائيات اللعبة:*\n`;
            resultMessage += `• 👤 *اللاعب:* ${senderName}\n`;
            resultMessage += `• ❓ *عدد الأسئلة:* ${questionsCount} سؤال\n`;
            resultMessage += `• ⏱️ *الوقت المستغرق:* ${gameTime} ثانية\n`;
            resultMessage += `━━━━━━━━━━━━━━━━━━━━\n`;

            if (global.gameStats[sender] && global.gameStats[sender].totalGames > 1) {
                const avgQuestions = Math.round(global.gameStats[sender].totalQuestions / global.gameStats[sender].totalGames);
                resultMessage += `🏆 *إحصائياتك الكلية:*\n`;
                resultMessage += `• 🎮 *عدد الألعاب:* ${global.gameStats[sender].totalGames}\n`;
                resultMessage += `• ❓ *متوسط الأسئلة:* ${avgQuestions}\n`;
                resultMessage += `• 🏅 *مرات الفوز:* ${global.gameStats[sender].wins}\n`;
            }

            resultMessage += `\n${designEnd}`;

            delete global.aki[sessionKey];

            if (data.photo) {
                return conn.sendMessage(jid, {
                    image: { url: data.photo },
                    caption: resultMessage
                }, { quoted: m });
            } else {
                return conn.sendMessage(jid, {
                    text: resultMessage
                }, { quoted: m });
            }
        }

        global.aki[sessionKey].step = data.step;
        global.aki[sessionKey].progression = data.progression;

        return await sendQuestion(conn, jid, data.question, m, '', '');
    } catch (err) {
        console.error(err);
        return conn.sendMessage(jid, {
            text: `${design}\n\n⚠️ حدث خطأ أثناء الإجابة، حاول مرة أخرى.\n\n${designEnd}`
        }, { quoted: m });
    }
}

// دالة الرجوع
async function goBack(conn, jid, session, sessionKey, m, senderName) {
    try {
        const response = await axios.post('https://mr-obito-api.vercel.app/api/akinator_back', {
            session: session.session,
            signature: session.signature,
            step: session.step,
            progression: session.progression,
            cm: "false"
        });

        const data = response.data;
        global.aki[sessionKey].step = data.step;
        global.aki[sessionKey].progression = data.progression;

        return await sendQuestion(conn, jid, data.question, m, '', '');
    } catch (err) {
        console.error(err);
        return conn.sendMessage(jid, {
            text: `${design}\n\n❌ لا يمكن الرجوع حالياً.\n\n${designEnd}`
        }, { quoted: m });
    }
}

// دالة إرسال السؤال (مع صورة ثابتة)
async function sendQuestion(conn, jid, question, m, usedPrefix, command) {
    try {
        const caption = `${design}\n\n🧞 *المارد الأزرق*\n\n📝 *السؤال:* ${question}\n\n━━━━━━━━━━━━━━━━━━━━\n📌 *أجب بأحد الأوامر:*\n• ${usedPrefix}${command} نعم\n• ${usedPrefix}${command} لا\n• ${usedPrefix}${command} لا أعرف\n• ${usedPrefix}${command} ربما\n• ${usedPrefix}${command} ربما لا\n━━━━━━━━━━━━━━━━━━━━\n🔄 *خيارات إضافية:*\n• ${usedPrefix}${command} رجوع - للعودة\n• ${usedPrefix}${command} حذف - لإنهاء اللعبة\n\n${designEnd}`;

        const staticImage = getStaticImage();

        if (staticImage) {
            await conn.sendMessage(jid, {
                image: staticImage,
                caption: caption
            }, { quoted: m });
        } else {
            await conn.sendMessage(jid, { text: caption }, { quoted: m });
        }
    } catch (e) {
        console.error('خطأ في إرسال السؤال:', e);
        await conn.sendMessage(jid, { text: question }, { quoted: m });
    }
}

handler.help = ['مارد'];
handler.tags = ['game'];
handler.command = ['مارد', 'akinator', 'المارد'];

export default handler;