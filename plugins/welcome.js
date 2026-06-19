// ====================================================
// نظام Welcome & Goodbye
// ====================================================
// يعتمد على hook جديد (plugin.participantsUpdate) تم إضافته في handler.js
// ليحل محل المنطق القديم المدمج داخل participantsUpdate (chat.welcome/sWelcome/sBye)
// ====================================================

import { sendSecurityLog } from '../lib/securityLogger.js'
import { createWelcomeCard } from '../lib/welcomeCard.js'
import fs from 'fs'
import path from 'path'

const BG_DIR = path.join(process.cwd(), 'database', 'welcomeBackgrounds')
if (!fs.existsSync(BG_DIR)) fs.mkdirSync(BG_DIR, { recursive: true })

const DEFAULTS = {
  welcome: 'أهلاً @user في مجموعة @group نتمنى لك وقتاً ممتعاً.',
  goodbye: 'وداعاً @user، نتمنى لك التوفيق.',
}

function getGroupData(groupId) {
  var db = global.db
  if (!db || !db.data) return null
  if (!db.data.groups) db.data.groups = {}
  if (!db.data.groups[groupId]) db.data.groups[groupId] = {}
  var g = db.data.groups[groupId]
  if (!g.welcome) g.welcome = { enabled: false, message: null, background: null, logEnabled: false }
  if (!g.goodbye) g.goodbye = { enabled: false, message: null, background: null, logEnabled: false }
  return g
}

function applyVars(template, vars) {
  return String(template)
    .replace(/@user/g, '@' + vars.userNumber)
    .replace(/@group/g, vars.groupName || '')
    .replace(/@members/g, String(vars.memberCount != null ? vars.memberCount : ''))
    .replace(/@desc/g, vars.desc || '')
}

function bgPath(groupId, type) {
  return path.join(BG_DIR, groupId.replace(/[^0-9]/g, '') + '-' + type + '.jpg')
}

// ============================================================
// أوامر الإعدادات: .welcome <on/off/msg/bg/log>   و   .bye <...>
// نفس أسلوب antilink.js (فحص أدمن/مالك يدويًا)
// ============================================================
let handler = async (m, { conn, usedPrefix, command, args }) => {
  var groupId = m.chat
  if (!groupId.endsWith('@g.us')) return m.reply('هذا الامر يعمل داخل الجروبات فقط!')

  var groupMetadata, participants
  try {
    groupMetadata = await conn.groupMetadata(groupId)
    participants = groupMetadata.participants || []
  } catch (e) {
    return m.reply('حدث خطأ في جلب بيانات الجروب')
  }

  var senderInfo = participants.find(function (p) { return p.id === m.sender })
  var isAdmin = senderInfo ? !!senderInfo.admin : false
  var ownerList = global.owner ? global.owner.map(function (o) { return o[0] + '@s.whatsapp.net' }) : []
  var isBotOwner = ownerList.includes(m.sender)

  if (!isAdmin && !isBotOwner) return m.reply('هذا الامر للادمن فقط!')

  var groupData = getGroupData(groupId)
  if (!groupData) return m.reply('خطأ في قاعدة البيانات!')

  var type = command === 'welcome' ? 'welcome' : 'goodbye'
  var label = type === 'welcome' ? 'Welcome' : 'Goodbye'
  var section = groupData[type]
  var sub = args[0] ? args[0].toLowerCase() : ''

  if (sub === 'on') {
    section.enabled = true
    return conn.sendMessage(groupId, { text: '✅ تم تفعيل نظام ' + label + ' لهذه المجموعة.' }, { quoted: m })
  }

  if (sub === 'off') {
    section.enabled = false
    return conn.sendMessage(groupId, { text: '🚫 تم إيقاف نظام ' + label + ' لهذه المجموعة.' }, { quoted: m })
  }

  if (sub === 'msg') {
    var rest = args.slice(1).join(' ')
    if (rest.toLowerCase() === 'reset') {
      section.message = null
      return m.reply('🔄 تم إرجاع رسالة ' + label + ' للوضع الافتراضي.')
    }
    if (!rest) {
      return m.reply(
        '📝 الرسالة الحالية:\n' + (section.message || DEFAULTS[type]) +
        '\n\nالمتغيرات المتاحة: @user @group @members @desc\n' +
        'لتغييرها: ' + usedPrefix + command + ' msg <النص>'
      )
    }
    section.message = rest
    return m.reply('✅ تم تحديث رسالة ' + label + '.')
  }

  if (sub === 'bg') {
    var second = args[1] ? args[1].toLowerCase() : ''
    if (second === 'reset') {
      var p = bgPath(groupId, type)
      if (fs.existsSync(p)) fs.unlinkSync(p)
      section.background = null
      return m.reply('🔄 تم إرجاع خلفية ' + label + ' الافتراضية.')
    }
    // يتطلب الرد على صورة
    var quoted = m.quoted
    if (!quoted || !/image/.test(quoted.mtype || '')) {
      return m.reply('❗ قم بالرد على صورة باستخدام ' + usedPrefix + command + ' bg لتعيينها كخلفية.')
    }
    try {
      // ⚠️ افترضنا أن الرسالة المقتبسة (quoted) لديها دالة download() حسب أسلوب simple.js
      // إذا كانت دالة التحميل في مشروعك باسم مختلف، عدّل هذا السطر فقط.
      var media = await quoted.download()
      var savePath = bgPath(groupId, type)
      fs.writeFileSync(savePath, media)
      section.background = savePath
      return m.reply('✅ تم تعيين خلفية ' + label + ' الجديدة.')
    } catch (e) {
      console.error('[Welcome/Goodbye] bg save error:', e)
      return m.reply('حدث خطأ أثناء حفظ الصورة.')
    }
  }

  if (sub === 'log') {
    var third = args[1] ? args[1].toLowerCase() : ''
    if (third === 'on') {
      section.logEnabled = true
      return m.reply('✅ تم تفعيل تسجيل ' + label + ' في GroupLog.')
    }
    if (third === 'off') {
      section.logEnabled = false
      return m.reply('🚫 تم إيقاف تسجيل ' + label + ' في GroupLog.')
    }
    return m.reply('استخدم: ' + usedPrefix + command + ' log on / off')
  }

  // بدون args → عرض الحالة
  return m.reply(
    '*⚙️ حالة نظام ' + label + '*\n' +
    '--------------------------\n' +
    'الحالة: ' + (section.enabled ? 'مفعّل ✅' : 'موقف 🚫') + '\n' +
    'الخلفية: ' + (section.background ? 'مخصصة' : 'افتراضية') + '\n' +
    'التسجيل (GroupLog): ' + (section.logEnabled ? 'مفعّل ✅' : 'موقف 🚫') + '\n\n' +
    'الأوامر:\n' +
    usedPrefix + command + ' on\n' +
    usedPrefix + command + ' off\n' +
    usedPrefix + command + ' msg <النص>\n' +
    usedPrefix + command + ' msg reset\n' +
    usedPrefix + command + ' bg (بالرد على صورة)\n' +
    usedPrefix + command + ' bg reset\n' +
    usedPrefix + command + ' log on/off'
  )
}

// ============================================================
// participantsUpdate — يُستدعى تلقائيًا من handler.js عند دخول/خروج/طرد عضو
// (تمت إضافة هذا الـ hook في handler.js بدلاً من المنطق القديم chat.welcome)
// ============================================================
handler.participantsUpdate = async function ({ id, participants, action, groupMetadata, simulate }) {
  var conn = this
  if (simulate) return
  if (action !== 'add' && action !== 'remove') return

  var type = action === 'add' ? 'welcome' : 'goodbye'
  var groupData = getGroupData(id)
  if (!groupData) return
  var section = groupData[type]
  if (!section || !section.enabled) return

  var groupName = groupMetadata.subject || ''
  var desc = groupMetadata.desc || ''
  var memberCount = (groupMetadata.participants || []).length

  for (var raw of participants) {
    try {
      var jid = conn.getJid ? conn.getJid(raw && raw.phoneNumber || raw.id) : (raw.id || raw)
      var userNumber = jid.split('@')[0]
      var pushName = (raw.notify || raw.name || userNumber)

      var template = section.message || DEFAULTS[type]
      var text = applyVars(template, { userNumber: userNumber, groupName: groupName, memberCount: memberCount, desc: desc })

      var avatarUrl = await conn.profilePictureUrl(jid, 'image').catch(function () { return null })

      var image = await createWelcomeCard({
        type: type,
        memberName: pushName,
        groupName: groupName,
        avatarUrl: avatarUrl,
        backgroundPath: section.background,
        subtitle: type === 'welcome' ? ('انضم إلى ' + groupName) : ('غادر ' + groupName),
      })

      await conn.sendMessage(id, {
        image: image,
        caption: text,
        mentions: [jid],
      })

      if (section.logEnabled) {
        await sendSecurityLog(conn, id, {
          groupName: groupName,
          userId: jid,
          action: type === 'welcome' ? 'Welcome' : 'Goodbye',
          reason: type === 'welcome' ? 'New member joined' : 'Member left or removed',
          extra: 'Members: ' + memberCount,
        })
      }
    } catch (e) {
      console.error('[Welcome/Goodbye] Error:', e)
    }
  }
}

// ============================================================
handler.help = ['welcome', 'bye']
handler.tags = ['group']
handler.command = ['welcome', 'bye']

handler.group = true
handler.admin = false
handler.botAdmin = false

handler.type    = 'protection'

export default handler
