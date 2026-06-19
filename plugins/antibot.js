/**
 * ============================================
 *  ANTIBOT — Protection Mode Command
 *  يحوّل البوت لوضع الحماية فقط داخل الجروب
 * ============================================
 *
 * لأي بلوغين حماية يشتغل مع antibot:
 *   handler.type = 'protection'
 * ============================================
 */

let handler = async (m, { conn, usedPrefix, command, text, isAdmin, isOwner }) => {
  // text هنا = الكلام بعد الأمر فقط، جاي من handler.js
  const arg = text?.trim().toLowerCase()

  if (!arg || !['on', 'off'].includes(arg)) {
    const currentState = global.db?.data?.chats?.[m.chat]?.antibot ?? false
    return m.reply(
      `🤖 *AntiBot — وضع الحماية*\n\n` +
      `الحالة الحالية: ${currentState ? '✅ مفعّل' : '❌ معطّل'}\n\n` +
      `الاستخدام:\n` +
      `• ${usedPrefix}antibot on  — تفعيل وضع الحماية\n` +
      `• ${usedPrefix}antibot off — إلغاء وضع الحماية`
    )
  }

  if (!global.db.data.chats[m.chat]) global.db.data.chats[m.chat] = {}

  if (arg === 'on') {
    global.db.data.chats[m.chat].antibot = true
    return m.reply(
      `🛡️ *تم تفعيل وضع الحماية*\n\n` +
      `جميع أوامر البوت معطّلة الآن في هذا الجروب.\n\n` +
      `الأنظمة التي تظل تعمل:\n` +
      `✅ AntiLink\n` +
      `✅ AntiWord\n` +
      `✅ Welcome / Goodbye\n` +
      `✅ جميع أنظمة الحماية (type: protection)\n\n` +
      `لإلغاء التفعيل: *${usedPrefix}antibot off*`
    )
  }

  if (arg === 'off') {
    global.db.data.chats[m.chat].antibot = false
    return m.reply(
      `✅ *تم إلغاء وضع الحماية*\n\n` +
      `جميع أوامر البوت تعمل الآن بشكل طبيعي.\n` +
      `أنظمة الحماية تستمر في العمل كالمعتاد.`
    )
  }
}

handler.help    = ['antibot']
handler.tags    = ['group']
handler.command = ['antibot']
handler.group   = true
handler.owner   = true
handler.type    = 'protection'

export default handler