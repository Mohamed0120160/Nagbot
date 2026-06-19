// ====================================================
// نظام Anti-Link
// ====================================================

import { sendSecurityLog } from '../lib/securityLogger.js'

function containsLink(text) {
  if (!text) return false
  var patterns = [
    /https?:\/\/[^\s]+/i,
    /www\.[a-z0-9\-]+\.[a-z]{2,}/i,
    /chat\.whatsapp\.com\/[^\s]+/i,
    /\b(bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly|adf\.ly|rb\.gy|short\.io|cutt\.ly|rebrand\.ly|tiny\.cc|bl\.ink|snip\.ly|clck\.ru)\b\/[^\s]*/i,
    /\b[a-z0-9\-]{2,}\.(com|net|org|io|co|me|ly|gg|app|dev|xyz|info|link|site|web|online|shop|store|live|tv|fm|news|blog|club|vip|pro|plus|top|win|fun)\b/i,
  ]
  return patterns.some(function(p) { return p.test(text) })
}

function isForwardedOrChannel(m) {
  if (m.msg && m.msg.contextInfo) {
    if (m.msg.contextInfo.isForwarded) return true
    if (m.msg.contextInfo.forwardingScore > 0) return true
    if (m.msg.contextInfo.remoteJid) {
      var jid = m.msg.contextInfo.remoteJid
      if (jid.endsWith('@broadcast') || jid.includes('newsletter') || jid.endsWith('@channel')) return true
    }
  }
  if (m.isForwarded) return true
  return false
}

function getGroupData(groupId) {
  var db = global.db
  if (!db || !db.data) return null
  if (!db.data.groups) db.data.groups = {}
  if (!db.data.groups[groupId]) db.data.groups[groupId] = {}
  return db.data.groups[groupId]
}

function getUserData(userId) {
  var db = global.db
  if (!db || !db.data) return null
  if (!db.data.users) db.data.users = {}
  if (!db.data.users[userId]) db.data.users[userId] = {}
  return db.data.users[userId]
}

// ============================================================
// Handler الأوامر
// ============================================================
let handler = async (m, { conn, usedPrefix, command, args }) => {

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

  if (command === 'antilink') {
    var sub = args[0] ? args[0].toLowerCase() : ''

    if (sub === 'on') {
      groupData.antilink = true
      if (!groupData.antilinkMode) groupData.antilinkMode = 'delete'
      var modeLabels = { delete: 'حذف فقط', warn: 'حذف + تحذير', kick: 'حذف + تحذير + طرد' }
      return conn.sendMessage(groupId, {
        text: '*تم تفعيل نظام Anti-Link!*\n\n' +
              'الجروب: ' + groupMetadata.subject + '\n' +
              'الوضع الحالي: ' + modeLabels[groupData.antilinkMode] + '\n\n' +
              'لتغيير الوضع:\n' +
              usedPrefix + 'antilinkmode delete\n' +
              usedPrefix + 'antilinkmode warn\n' +
              usedPrefix + 'antilinkmode kick'
      }, { quoted: m })
    }

    if (sub === 'off') {
      groupData.antilink = false
      return conn.sendMessage(groupId, {
        text: '*تم ايقاف نظام Anti-Link!*\n\nالجروب: ' + groupMetadata.subject
      }, { quoted: m })
    }

    return conn.sendMessage(groupId, {
      text: '*حالة نظام Anti-Link:*\n\n' +
            'الجروب: ' + groupMetadata.subject + '\n' +
            'الحالة: ' + (groupData.antilink ? 'مفعّل' : 'موقف') + '\n' +
            'الوضع: ' + (groupData.antilinkMode || 'delete') + '\n\n' +
            'الاوامر:\n' +
            usedPrefix + 'antilink on\n' +
            usedPrefix + 'antilink off\n' +
            usedPrefix + 'antilinkmode delete\n' +
            usedPrefix + 'antilinkmode warn\n' +
            usedPrefix + 'antilinkmode kick'
    }, { quoted: m })
  }

  if (command === 'antilinkmode') {
    var sub = args[0] ? args[0].toLowerCase() : ''
    var validModes = {
      delete: 'حذف الرسالة فقط',
      warn:   'حذف الرسالة + تحذير',
      kick:   'حذف + تحذير + طرد',
    }
    if (!validModes[sub]) {
      return m.reply('وضع غير صحيح!\n\n' +
        usedPrefix + 'antilinkmode delete\n' +
        usedPrefix + 'antilinkmode warn\n' +
        usedPrefix + 'antilinkmode kick')
    }
    groupData.antilinkMode = sub
    return conn.sendMessage(groupId, {
      text: '*تم تغيير وضع Anti-Link!*\n\n' +
            'الجروب: ' + groupMetadata.subject + '\n' +
            'الوضع الجديد: ' + sub + '\n' +
            'التفاصيل: ' + validModes[sub]
    }, { quoted: m })
  }
}

// ============================================================
// all() — بيشتغل على كل رسالة
// ✅ handler.js بيبعت all() فقط: { chatUpdate, __dirname, __filename }
// ✅ مش بيبعت conn — لازم نستخدم (this) بدلاً منه
// ============================================================
handler.all = async function (m, { chatUpdate }) {
  // this = conn هنا لأن handler.js بيعمل plugin.all.call(this, m, {...})
  var conn = this

  if (!m.chat.endsWith('@g.us')) return
  if (m.isBaileys) return

  var groupId   = m.chat
  var groupData = getGroupData(groupId)
  if (!groupData || !groupData.antilink) return

  var isForwarded = isForwardedOrChannel(m)
  var msgText     = m.text || (m.msg && (m.msg.caption || m.msg.text)) || ''
  var hasLink     = containsLink(msgText)

  if (!hasLink && !isForwarded) return

  try {
    var groupMetadata = await conn.groupMetadata(groupId)
    var participants  = groupMetadata.participants || []

    var senderData = participants.find(function(p) { return p.id === m.sender })
    var isAdmin    = senderData ? !!senderData.admin : false
    var ownerList  = global.owner ? global.owner.map(function(o) { return o[0] + '@s.whatsapp.net' }) : []
    var isBotOwner = ownerList.includes(m.sender)

    if (isAdmin || isBotOwner) return

    var mode         = groupData.antilinkMode || 'delete'
    var senderNumber = m.sender.replace('@s.whatsapp.net', '')
    var groupName    = groupMetadata.subject

    var reason = 'Link detected'
    if (isForwarded && !hasLink)     reason = 'Forwarded/Channel message'
    else if (isForwarded && hasLink) reason = 'Link + Forwarded message'

    var actionLabels = { delete: 'Delete', warn: 'Delete + Warn', kick: 'Delete + Warn + Kick' }

    // حذف
    await conn.sendMessage(groupId, { delete: m.key })

    // تحذير
    if (mode === 'warn' || mode === 'kick') {
      var userData = getUserData(m.sender)
      if (userData) {
        var warnKey       = 'warn_' + groupId
        userData[warnKey] = (userData[warnKey] || 0) + 1
        var warnCount     = userData[warnKey]

        await conn.sendMessage(groupId, {
          text: '*تحذير | Anti-Link*\n' +
                '--------------------------\n' +
                '@' + senderNumber + '\n\n' +
                'السبب: ' + reason + '\n' +
                'عدد التحذيرات: ' + warnCount + '\n\n' +
                'يمنع ارسال اي روابط او رسائل محولة في هذا الجروب',
          mentions: [m.sender]
        })
      }
    }

    // طرد
    if (mode === 'kick') {
      var botId      = conn.user.id.replace(/:.*@/, '@')
      var botData    = participants.find(function(p) { return p.id === botId })
      var isBotAdmin = botData ? !!botData.admin : false

      if (isBotAdmin) {
        await conn.groupParticipantsUpdate(groupId, [m.sender], 'remove')
        await conn.sendMessage(groupId, {
          text: 'تم طرد @' + senderNumber + ' بسبب: ' + reason,
          mentions: [m.sender]
        })
      } else {
        await conn.sendMessage(groupId, { text: 'البوت ليس ادمن، لا يمكن طرد المستخدم!' })
      }
    }

    // لوج
    var detectedContent = hasLink
      ? (msgText.match(/(?:https?:\/\/|www\.)[^\s]+/i) || [''])[0] || msgText.slice(0, 80)
      : '[ Forwarded / Channel Message ]'

    await sendSecurityLog(conn, groupId, {
      groupName: groupName,
      userId:    m.sender,
      action:    actionLabels[mode],
      reason:    reason,
      extra:     detectedContent.slice(0, 100)
    })

  } catch (err) {
    console.error('[Anti-Link] Error:', err.message)
  }
}

// ============================================================
handler.help    = ['antilink']
handler.tags    = ['group']
handler.command = ['antilink', 'antilinkmode']

handler.group    = false
handler.admin    = false
handler.botAdmin = false

handler.type    = 'protection'

export default handler
