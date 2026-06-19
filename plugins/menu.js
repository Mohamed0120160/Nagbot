import moment from 'moment-timezone'
import fs from 'fs'

const handler = async (m, { conn, usedPrefix: _p, isOwner }) => {
  try {
    const plugins = Object.values(global.plugins || {}).filter(p => !p.disabled && p !== handler)

    const tagMap = new Map()
    plugins.forEach(p => {
      const tags  = Array.isArray(p.tags) ? p.tags : (p.tags ? [p.tags] : [])
      const helps = Array.isArray(p.help) ? p.help : (p.help ? [p.help] : [])
      tags.forEach(t => {
        if (!t || t === 'main') return
        const key = t.toLowerCase()
        tagMap.set(key, (tagMap.get(key) || 0) + helps.filter(Boolean).length)
      })
    })

    let tags = [...tagMap.entries()]
    if (!isOwner)   tags = tags.filter(([t]) => t !== 'owner')
    if (!m.isGroup) tags = tags.filter(([t]) => t !== 'group')
    tags.sort((a, b) => a[0].localeCompare(b[0]))

    const uptime    = clockString(process.uptime() * 1000)
    const totalreg  = Object.keys(global.db?.data?.users  || {}).length
    const rtotalreg = Object.values(global.db?.data?.users || {}).filter(u => u.registered).length
    const now       = moment.tz('Africa/Cairo')
    const date      = now.format('ddd، DD MMM YYYY')
    const time      = now.format('HH:mm')

    const name = global.db?.data?.users?.[m.sender]?.registered
      ? global.db.data.users[m.sender].name
      : conn.getName(m.sender)

    const EMOJI = {
      ai:'🤖', tools:'🔧', downloader:'📥', uploader:'📤',
      editor:'✏️', sticker:'🎭', group:'👥', owner:'👑',
      info:'ℹ️', game:'🎮', media:'📸', utility:'⚙️',
    }

    const sectionLines = tags.map(([tag]) => {
      const emoji = EMOJI[tag] || '📌'
      return `${emoji} ${tag.toUpperCase()} ➜ ${_p}${tag}`
    }).join('\n')

    const div = '───────────────────'

    const caption = `${div}
         🥰 *${conn.user.name}* 🥰
${div}
${ucapan()} ${name} 
📅 التاريخ:${date}
🕐 الوقت:${time} 
🛜 مرفوع:${uptime}
${div}
📂 *الاقسام*
${div}
${sectionLines}
${div}
💡 اكتب اسم القسم للدخول`

    await conn.sendMessage(
      m.chat,
      {
        image: fs.readFileSync('./media/menu.jpg'),
        caption,
      },
      { quoted: m }
    )

  } catch (e) {
    console.error(e)
    m.reply('❌ خطأ في عرض القائمة.')
  }
}

handler.help = ['menu']
handler.tags = ['main']
handler.command = /^(menu|مساعده|اوامر|أوامر|help|\?)$/i

export default handler

function clockString(ms) {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor(ms / 60000) % 60
  const s = Math.floor(ms / 1000) % 60
  return [h, m, s].map(v => v.toString().padStart(2, 0)).join(':')
}

function ucapan() {
  const h = parseInt(moment.tz('Africa/Cairo').format('HH'))
  if (h < 4)  return 'مساء الخير'
  if (h < 10) return 'صباح الخير'
  if (h < 15) return 'صباح الخير'
  if (h < 18) return 'مساء الخير'
  return 'مساء الخير'
}