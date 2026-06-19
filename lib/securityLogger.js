// ====================================================
// 🛡️ Security Logger - دالة مشتركة لكل أنظمة الحماية
// الاستخدام: import { sendSecurityLog } from './lib/securityLogger.js'
// ====================================================

/**
 * 📤 ترسل رسالة لوج لجروب اللوج الخاص بالجروب
 *
 * @param {object} conn        - كونكشن البوت
 * @param {string} groupId     - ID الجروب اللي حصل فيه الحدث
 * @param {object} logData     - بيانات الحدث
 * @param {string} logData.groupName  - اسم الجروب
 * @param {string} logData.userId     - JID المستخدم  (مثال: 201xxxxxxxx@s.whatsapp.net)
 * @param {string} logData.action     - الإجراء (مثال: "Delete + Warn")
 * @param {string} logData.reason     - السبب (مثال: "Link detected")
 * @param {string} [logData.extra]    - أي معلومات إضافية اختيارية
 */
export async function sendSecurityLog(conn, groupId, logData) {
  try {

    // ✅ جيب إعدادات اللوج للجروب ده
    const groupData = global.db?.data?.groups?.[groupId]
    const logGroupId = groupData?.logGroup

    // لو مفيش جروب لوج محدد → تجاهل
    if (!logGroupId) return

    // ✅ استخرج رقم المستخدم بشكل نضيف
    const userNumber = logData.userId
      ? logData.userId.replace(/@s\.whatsapp\.net$/, '').replace(/@.*$/, '')
      : 'غير معروف'

    // ✅ الوقت الحالي
    const now  = new Date()
    const time = now.toLocaleTimeString('ar-EG', {
      hour:   '2-digit',
      minute: '2-digit',
      hour12: true,
    })
    const date = now.toLocaleDateString('ar-EG', {
      day:   'numeric',
      month: 'numeric',
      year:  'numeric',
    })

    // ✅ بناء رسالة اللوج
    const logMessage =
      `🚨 *Security Log*\n` +
      `${'─'.repeat(28)}\n` +
      `👥 *Group:* ${logData.groupName || 'غير معروف'}\n` +
      `👤 *User:* @${userNumber}\n` +
      `📞 *Number:* ${userNumber}\n` +
      `${'─'.repeat(28)}\n` +
      `⚠️ *Action:* ${logData.action || '—'}\n` +
      `🔍 *Reason:* ${logData.reason || '—'}\n` +
      (logData.extra ? `📝 *Details:* ${logData.extra}\n` : '') +
      `${'─'.repeat(28)}\n` +
      `📅 *Date:* ${date}\n` +
      `⏱ *Time:* ${time}`

    // ✅ إرسال اللوج مع mention للمستخدم
    await conn.sendMessage(logGroupId, {
      text:     logMessage,
      mentions: logData.userId ? [logData.userId] : [],
    })

  } catch (err) {
    // لو فيه خطأ في الإرسال → متوقفش باقي الكود
    console.error('[SecurityLogger] Failed to send log:', err.message)
  }
}

// ====================================================
// 📌 أمثلة الاستخدام في أنظمة الحماية المختلفة:
// ====================================================
//
// ─── Anti-Link ───────────────────────────────────────
// await sendSecurityLog(conn, m.chat, {
//   groupName: groupMetadata.subject,
//   userId:    m.sender,
//   action:    'Delete + Warn',
//   reason:    'Link detected',
//   extra:     m.text?.slice(0, 60) + '...',
// })
//
// ─── Anti-Spam / Flood ───────────────────────────────
// await sendSecurityLog(conn, m.chat, {
//   groupName: groupMetadata.subject,
//   userId:    m.sender,
//   action:    'Warn',
//   reason:    'Flood detected (15 messages/10s)',
// })
//
// ─── Kick ────────────────────────────────────────────
// await sendSecurityLog(conn, m.chat, {
//   groupName: groupMetadata.subject,
//   userId:    targetUser,
//   action:    'Kick',
//   reason:    'Repeated violations',
// })
//
// ─── Anti-Bad Words ──────────────────────────────────
// await sendSecurityLog(conn, m.chat, {
//   groupName: groupMetadata.subject,
//   userId:    m.sender,
//   action:    'Delete + Warn',
//   reason:    'Bad word detected',
// })
// ====================================================