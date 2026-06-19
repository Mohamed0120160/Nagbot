// ====================================================
// 📢 Group Security Log System
// أوامر: setlog / showlog / removelog
// ====================================================

function getGroupData(groupId) {
  var db = global.db
  if (!db || !db.data) return null
  if (!db.data.groups) db.data.groups = {}
  if (!db.data.groups[groupId]) db.data.groups[groupId] = {}
  return db.data.groups[groupId]
}

let handler = async (m, { conn, usedPrefix, command, args, text }) => {

  var groupId = m.chat
  if (!groupId.endsWith('@g.us')) return m.reply('هذا الامر يعمل داخل الجروبات فقط!')

  var groupMetadata, participants
  try {
    groupMetadata = await conn.groupMetadata(groupId)
    participants  = groupMetadata.participants || []
  } catch(e) {
    return m.reply('حدث خطأ في جلب بيانات الجروب')
  }

  var senderInfo = participants.find(function(p) { return p.id === m.sender })
  var isAdmin    = senderInfo ? !!senderInfo.admin : false
  var ownerList  = global.owner ? global.owner.map(function(o) { return o[0] + '@s.whatsapp.net' }) : []
  var isBotOwner = ownerList.includes(m.sender)

  if (!isAdmin && !isBotOwner) return m.reply('هذا الامر للادمن فقط!')

  var groupData = getGroupData(groupId)
  if (!groupData) return m.reply('خطأ في قاعدة البيانات!')

  // ── setlog ──────────────────────────────────────────────
  if (command === 'setlog' || command === 'setloggroup') {
    var targetGroupId = null

    if (m.quoted && m.quoted.chat && m.quoted.chat.endsWith('@g.us')) {
      targetGroupId = m.quoted.chat
    } else if (text && text.trim().endsWith('@g.us')) {
      targetGroupId = text.trim()
    } else {
      targetGroupId = groupId
    }

    try {
      var targetMeta = await conn.groupMetadata(targetGroupId)
      groupData.logGroup     = targetGroupId
      groupData.logGroupName = targetMeta.subject

      return conn.sendMessage(groupId, {
        text: '*تم تعيين جروب اللوج بنجاح!*\n\n' +
              'جروب اللوج: ' + targetMeta.subject + '\n' +
              'ID: ' + targetGroupId + '\n\n' +
              'سيتم ارسال جميع احداث الحماية لهذا الجروب تلقائيا'
      }, { quoted: m })
    } catch (e) {
      return m.reply('تعذر الوصول للجروب المحدد، تاكد ان البوت موجود فيه!')
    }
  }

  // ── showlog ─────────────────────────────────────────────
  if (command === 'showlog' || command === 'showloggroup' || command === 'loginfo') {
    var logGroupId   = groupData.logGroup
    var logGroupName = groupData.logGroupName

    if (!logGroupId) {
      return conn.sendMessage(groupId, {
        text: '*اعدادات اللوج للجروب:*\n\n' +
              'الجروب: ' + groupMetadata.subject + '\n' +
              'جروب اللوج: غير محدد\n\n' +
              'استخدم ' + usedPrefix + 'setlog لتعيين جروب اللوج'
      }, { quoted: m })
    }

    try {
      var logMeta = await conn.groupMetadata(logGroupId)
      return conn.sendMessage(groupId, {
        text: '*اعدادات اللوج للجروب:*\n\n' +
              'الجروب: ' + groupMetadata.subject + '\n' +
              'جروب اللوج: ' + logMeta.subject + '\n' +
              'ID: ' + logGroupId
      }, { quoted: m })
    } catch (e) {
      return conn.sendMessage(groupId, {
        text: '*اعدادات اللوج:*\n\n' +
              'الجروب: ' + groupMetadata.subject + '\n' +
              'جروب اللوج: ' + (logGroupName || logGroupId) + ' (قد لا يكون البوت موجودا فيه)'
      }, { quoted: m })
    }
  }

  // ── removelog ────────────────────────────────────────────
  if (command === 'removelog' || command === 'dellog' || command === 'unsetlog') {
    if (!groupData.logGroup) return m.reply('لا يوجد جروب لوج معين لهذا الجروب اصلا!')

    var oldName = groupData.logGroupName || groupData.logGroup
    delete groupData.logGroup
    delete groupData.logGroupName

    return conn.sendMessage(groupId, {
      text: '*تم الغاء جروب اللوج بنجاح!*\n\n' +
            'الجروب: ' + groupMetadata.subject + '\n' +
            'تم ازالة: ' + oldName
    }, { quoted: m })
  }
}

// ============================================================
handler.help    = ['setlog', 'showlog', 'removelog']
handler.tags    = ['group']
handler.command = [
  'setlog', 'setloggroup',
  'showlog', 'showloggroup', 'loginfo',
  'removelog', 'dellog', 'unsetlog'
]

handler.group    = false
handler.admin    = false
handler.botAdmin = false

handler.type    = 'protection'

export default handler