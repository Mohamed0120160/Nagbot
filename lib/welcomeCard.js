// ====================================================
// 🖼️ Welcome / Goodbye Card Generator
// يستخدم مكتبة @napi-rs/canvas لإنشاء صورة دائرية للعضو فوق خلفية
// الاستخدام: import { createWelcomeCard } from './lib/welcomeCard.js'
// ====================================================

import { createCanvas, loadImage } from '@napi-rs/canvas'
import fs from 'fs'

const THEMES = {
  welcome: { from: '#0f2027', to: '#2c5364', accent: '#00c9a7', label: 'WELCOME' },
  goodbye: { from: '#3a1c1c', to: '#6b2737', accent: '#ff6b6b', label: 'GOODBYE' },
}

const WIDTH = 1000
const HEIGHT = 500
const AVATAR_SIZE = 220

function drawGradientBackground(ctx, theme) {
  const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT)
  gradient.addColorStop(0, theme.from)
  gradient.addColorStop(1, theme.to)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, WIDTH, HEIGHT)
}

function truncate(str, max) {
  str = String(str || '')
  return str.length > max ? str.slice(0, max - 1) + '…' : str
}

/**
 * @param {object} opts
 * @param {'welcome'|'goodbye'} opts.type
 * @param {string} opts.memberName     - اسم العضو (للعرض النصي وكـ fallback للأفاتار)
 * @param {string} opts.groupName      - اسم المجموعة
 * @param {string|null} opts.avatarUrl - رابط صورة العضو الشخصية (أو null)
 * @param {string|null} opts.backgroundPath - مسار خلفية مخصصة على القرص (أو null)
 * @param {string} [opts.subtitle]     - سطر فرعي اختياري (افتراضيًا اسم المجموعة)
 * @returns {Promise<Buffer>} PNG buffer
 */
export async function createWelcomeCard({ type = 'welcome', memberName, groupName, avatarUrl, backgroundPath, subtitle }) {
  const theme = THEMES[type] || THEMES.welcome
  const canvas = createCanvas(WIDTH, HEIGHT)
  const ctx = canvas.getContext('2d')

  // ---- الخلفية ----
  let drewCustomBg = false
  if (backgroundPath && fs.existsSync(backgroundPath)) {
    try {
      const bg = await loadImage(backgroundPath)
      ctx.drawImage(bg, 0, 0, WIDTH, HEIGHT)
      drewCustomBg = true
    } catch (e) {
      console.error('[welcomeCard] failed to load custom background:', e.message)
    }
  }
  if (!drewCustomBg) drawGradientBackground(ctx, theme)

  // تظليل لتحسين وضوح النص
  ctx.fillStyle = 'rgba(0,0,0,0.38)'
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  // ---- الأفاتار الدائري ----
  const cx = WIDTH / 2
  const cy = 190

  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, AVATAR_SIZE / 2 + 8, 0, Math.PI * 2)
  ctx.fillStyle = theme.accent
  ctx.fill()
  ctx.restore()

  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, AVATAR_SIZE / 2, 0, Math.PI * 2)
  ctx.closePath()
  ctx.clip()
  try {
    if (!avatarUrl) throw new Error('no avatar url')
    const avatar = await loadImage(avatarUrl)
    ctx.drawImage(avatar, cx - AVATAR_SIZE / 2, cy - AVATAR_SIZE / 2, AVATAR_SIZE, AVATAR_SIZE)
  } catch (e) {
    // صورة افتراضية: دائرة بحرف اسم العضو
    ctx.fillStyle = '#444'
    ctx.fillRect(cx - AVATAR_SIZE / 2, cy - AVATAR_SIZE / 2, AVATAR_SIZE, AVATAR_SIZE)
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 90px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText((memberName || '?').trim().charAt(0).toUpperCase(), cx, cy + 8)
  }
  ctx.restore()

  // ---- النصوص ----
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'

  ctx.fillStyle = theme.accent
  ctx.font = 'bold 34px sans-serif'
  ctx.fillText(theme.label, cx, 330)

  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 42px sans-serif'
  ctx.fillText(truncate(memberName, 28), cx, 385)

  ctx.fillStyle = '#dddddd'
  ctx.font = '26px sans-serif'
  ctx.fillText(truncate(subtitle || groupName, 50), cx, 425)

  return canvas.toBuffer('image/png')
}
