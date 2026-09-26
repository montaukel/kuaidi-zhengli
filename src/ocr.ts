import { createWorker, PSM } from 'tesseract.js'
import type { Carrier, ParcelStatus, Platform } from './types'
import { applyLearnedCorrections } from './learning'

export interface OcrResult {
  rawText: string
  platform: Platform
  carrier: Carrier
  trackingNumber: string
  pickupSite: string
  pickupAddress: string
  pickupCode: string
  productName: string
  status: ParcelStatus
}

const carrierRules: Array<[Carrier, RegExp]> = [
  ['京东物流', /京东物流|JD\s*物流/i],
  ['邮政 EMS', /邮政|EMS|邮政速递/i],
  ['顺丰', /顺丰|SF\s*EXPRESS/i],
  ['极兔', /极兔|J&T/i],
  ['韵达', /韵达/i],
  ['圆通', /圆通/i],
  ['中通', /中通/i],
  ['申通', /申通/i]
]

const platformRules: Array<[Platform, RegExp]> = [
  ['拼多多', /拼多多|多多买菜/],
  ['抖音', /抖音商城|抖音电商|抖音/],
  ['小红书', /小红书|RED\s*NOTE/i],
  ['唯品会', /唯品会|VIPSHOP/i],
  ['得物', /得物|POIZON/i],
  ['淘宝', /淘宝|淘天|天猫/],
  ['京东', /京东商城|京东购物|京东订单/]
]

export function cleanNumber(value: string) {
  return value
    .toUpperCase()
    .replace(/[｜|]/g, '1')
    .replace(/[：:\s·•]/g, '')
    .replace(/[—–]/g, '-')
    .replace(/[，,。；;]/g, '')
    .replace(/[^A-Z0-9-]/g, '')
}

function numberNear(text: string, labels: string[]) {
  const normalized = text.replace(/[｜|]/g, '1')
  const lines = normalized.split(/\n+/)
  for (const label of labels) {
    const flexibleLabel = label.split('').join('\\s*')
    const labelRule = new RegExp(flexibleLabel, 'i')
    for (let index = 0; index < lines.length; index += 1) {
      if (!labelRule.test(lines[index])) continue
      const sameLine = lines[index].match(new RegExp(`${flexibleLabel}\\s*[：:]?\\s*([A-Za-z0-9][A-Za-z0-9\\s-]{6,32})`, 'i'))
      const sameLineNumber = sameLine ? cleanNumber(sameLine[1]) : ''
      if (sameLineNumber.length >= 8) return sameLineNumber
      const nextLineNumber = cleanNumber(lines[index + 1] ?? '')
      if (nextLineNumber.length >= 8 && nextLineNumber.length <= 32) return nextLineNumber
    }
  }
  return ''
}

function cleanText(value: string) {
  let cleaned = value.replace(/^[^\u4e00-\u9fffA-Za-z0-9]+/, '').replace(/[】\]\s]+$/g, '').replace(/\s+/g, ' ').trim()
  for (let pass = 0; pass < 3; pass += 1) cleaned = cleaned.replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, '$1')
  return cleaned
    .replace(/^[图标]*送\s*至\s*/, '')
    .replace(/[.…]{1,}\s*展开.*$/, '')
    .trim()
}

function textNearLabel(text: string, labels: string[]) {
  const lines = text.split(/\n+/).map(cleanText).filter(Boolean)
  for (const label of labels) {
    const flexibleLabel = label.split('').join('\\s*')
    const rule = new RegExp(`^${flexibleLabel}\\s*[：:]?\\s*(.*)$`, 'i')
    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(rule)
      if (!match) continue
      const value = cleanText(match[1] || lines[index + 1] || '')
      if (value.length >= 3) return value.slice(0, 80)
    }
  }
  return ''
}

function extractPickupCode(text: string) {
  const lines = text.replace(/[—–]/g, '-').split(/\n+/)
  for (const line of lines) {
    const match = line.match(/取\s*件\s*码\s*[：:]?\s*([A-Z0-9][A-Z0-9\s-]{3,22})/i)
    if (!match) continue
    const code = match[1].toUpperCase().replace(/\s+/g, '').replace(/-+/g, '-')
    if (code.length >= 5) return code
  }
  return ''
}

function extractPickupSite(text: string, address: string) {
  const normalized = text.split(/\n+/).map(cleanText).join('\n')
  const compact = normalized.replace(/\s*\n\s*/g, '')
  const patterns = [
    /代收点的\s*[【\[]([^】\]]{3,60})[】\]]/,
    /代收点的\s*[【\[]([^，。]{3,60}?)(?:暂放|请及时|取件地址)/,
    /已由\s*([^，,。\n]{3,40}?)(?:代收|签收)/,
    /送至\s*([^\n]{3,40})/
  ]
  for (const pattern of patterns) {
    const value = cleanText(compact.match(pattern)?.[1] ?? normalized.match(pattern)?.[1] ?? '')
    if (value) return value
  }
  const candidates = text.split(/\n+/).map(cleanText).filter((line) =>
    line.length >= 4 && line.length <= 45 && /驿站|快递站|代收点|快递中心|大学.*店|菜鸟|丰巢/.test(line)
  )
  return candidates.at(-1) ?? (/驿站|快递站|代收点/.test(address) ? address : '')
}

function extractProductName(text: string) {
  const normalized = text.split(/\n+/).map(cleanText).join('\n')
  const match = normalized.match(/(?:旗舰店|专卖店|专营店|自营店|店铺)\s*[>›]?\s*(?:\n\s*)?([^\n¥￥]{4,60})/)
  return simplifyProductName(cleanText(match?.[1] ?? '').replace(/\.{2,}.*$/, ''))
}

export function simplifyProductName(value: string) {
  const text = cleanText(value)
    .replace(/[¥￥]\s*\d+(?:\.\d+)?/g, '')
    .replace(/\b\d+(?:g|kg|cm|mm|ml|袋|包|件|盒|瓶|厘米|毫米)\b.*$/gi, '')
    .replace(/旗舰店|专卖店|专营店|官方店|自营店|店铺/g, '')
    .trim()
  if (!text) return ''
  if (/床垫|榻榻米/.test(text)) return /榻榻米/.test(text) ? '榻榻米床垫' : '床垫'
  if (/鸡脚|鸡爪/.test(text)) {
    const flavor = ['酸辣', '柠檬', '山椒', '泡椒'].filter((word) => text.includes(word)).slice(0, 2).join('')
    return `${flavor || ''}鸡脚/鸡爪`
  }
  if (/充电|数据线/.test(text)) return '充电数据线'
  if (/纸巾|抽纸|卷纸/.test(text)) return '纸巾'
  const chinese = text.match(/[\u4e00-\u9fffA-Za-z0-9]{2,}/g)?.join('') ?? text
  return chinese.slice(0, 14)
}

export function parseOcrText(rawText: string): OcrResult {
  const normalizedText = rawText.split(/\n+/).map(cleanText).join('\n')
  const platform = platformRules.find(([, rule]) => rule.test(normalizedText))?.[0] ?? '待确认'
  let carrier = carrierRules.find(([, rule]) => rule.test(normalizedText))?.[0] ?? '待确认'
  const labeledTrackingNumber = numberNear(normalizedText, ['快递单号', '运单号码', '运单号', '物流单号'])
  const carrierNumber = normalizedText.match(/(?:顺丰速运|顺丰|中通快递|圆通速递|圆通|韵达快递|韵达|申通快递|极兔速递|京东物流|邮政EMS)\s*[：:]?\s*([A-Z]{0,3}\s*[0-9][A-Z0-9\s-]{7,24})/i)?.[1] ?? ''
  const genericCourierNumber = normalizedText.match(/(?:[\u4e00-\u9fffA-Za-z]{1,10}快递)\s*[：:]\s*([A-Z]{0,3}\s*[0-9][A-Z0-9\s-]{7,24})/i)?.[1] ?? ''
  // “SF + 长号码”本身就是足够可靠的顺丰特征；即使中文公司名被 OCR 漏掉，也不应要求用户重填。
  const sfNumber = normalizedText.match(/(?:^|\s)(S\s*F\s*[0-9][A-Z0-9\s-]{9,24})(?=\s|$|复制|物流)/im)?.[1] ?? ''
  const trackingNumber = labeledTrackingNumber || cleanNumber(carrierNumber) || cleanNumber(genericCourierNumber) || cleanNumber(sfNumber)
  if (carrier === '待确认' && /^SF[0-9A-Z]{10,}$/i.test(trackingNumber)) carrier = '顺丰'
  const pickupCode = extractPickupCode(rawText)
  const pickupAddress = textNearLabel(rawText, ['取件地址', '代收点地址', '收货地址'])
  const pickupSite = extractPickupSite(rawText, pickupAddress)
  const productName = extractProductName(rawText)
  const status: ParcelStatus = /已签收|签收成功|已送达|已妥投/.test(normalizedText)
    ? '已签收'
    : /运输中|派送中|派件中|运输途中|正在运输|已发货|已揽收/.test(normalizedText)
      ? '运输中'
      : '待确认'
  return { rawText, platform, carrier, trackingNumber, pickupSite, pickupAddress, pickupCode, productName, status }
}

async function createTrackingRegion(file: File) {
  const bitmap = await createImageBitmap(file)
  const sourceTop = Math.round(bitmap.height * 0.16)
  const sourceHeight = Math.round(bitmap.height * 0.5)
  const scale = Math.min(2, 2200 / bitmap.width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(sourceHeight * scale)
  const context = canvas.getContext('2d')
  if (context) {
    context.filter = 'grayscale(1) contrast(1.45)'
    context.drawImage(bitmap, 0, sourceTop, bitmap.width, sourceHeight, 0, 0, canvas.width, canvas.height)
  }
  bitmap.close()
  return canvas
}

export async function recognizeImage(file: File, onProgress: (value: number) => void) {
  let reportProgress = true
  const worker = await createWorker(['chi_sim', 'eng'], 1, {
    logger: (message) => {
      if (reportProgress && message.status === 'recognizing text') onProgress(Math.round(message.progress * 100))
    }
  })
  try {
    const { data } = await worker.recognize(file, {}, { blocks: true })
    reportProgress = false
    const lines = (data.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines))
    const trackingLine = lines
      .filter((line) => line.text.replace(/\D/g, '').length >= 8 && /顺\s*丰|速\s*运|快\s*递|复制|物流\s*电话|S\s*F/i.test(line.text))
      .sort((left, right) => {
        const score = (text: string) => (/顺\s*丰|S\s*F/i.test(text) ? 30 : 0) + (/复制|物流\s*电话/.test(text) ? 20 : 0) + text.replace(/\D/g, '').length
        return score(right.text) - score(left.text)
      })[0]
    let combinedText = data.text
    if (trackingLine) {
      const { x0, y0, x1, y1 } = trackingLine.bbox
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE })
      const refined = await worker.recognize(file, {
        rectangle: {
          left: Math.max(0, x0 - 24),
          top: Math.max(0, y0 - 36),
          width: x1 - x0 + 48,
          height: y1 - y0 + 72
        }
      })
      combinedText = `${refined.data.text}\n${combinedText}`
    }
    let parsed = parseOcrText(combinedText)
    if (!parsed.trackingNumber) {
      const trackingRegion = await createTrackingRegion(file)
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT })
      const regional = await worker.recognize(trackingRegion)
      parsed = parseOcrText(`${regional.data.text}\n${combinedText}`)
    }
    return applyLearnedCorrections(parsed)
  } finally {
    await worker.terminate()
  }
}
