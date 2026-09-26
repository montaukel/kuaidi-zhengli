import type { Carrier } from './types'

export type LearningField = 'pickupSite' | 'carrier' | 'productName'

interface LearningRule {
  field: LearningField
  from: string
  to: string
  updatedAt: string
}

const STORAGE_KEY = 'kuaidi-zhengli-learning-v1'

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '')
}

function readRules(): LearningRule[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown
    if (!Array.isArray(value)) return []
    return value.filter((item): item is LearningRule => {
      if (!item || typeof item !== 'object') return false
      const rule = item as Record<string, unknown>
      return ['pickupSite', 'carrier', 'productName'].includes(String(rule.field))
        && typeof rule.from === 'string' && typeof rule.to === 'string' && typeof rule.updatedAt === 'string'
    })
  } catch {
    return []
  }
}

function writeRules(rules: LearningRule[]) {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rules)) } catch { /* 浏览器拒绝存储时不影响包裹保存 */ }
}

function bigrams(value: string) {
  const result = new Set<string>()
  for (let index = 0; index < value.length - 1; index += 1) result.add(value.slice(index, index + 2))
  return result
}

function similarity(left: string, right: string) {
  const a = normalize(left)
  const b = normalize(right)
  if (!a || !b) return 0
  if (a === b) return 1
  if (Math.min(a.length, b.length) >= 3 && (a.includes(b) || b.includes(a))) return .86
  if (Math.min(a.length, b.length) < 5) return 0
  const aPairs = bigrams(a)
  const bPairs = bigrams(b)
  const shared = [...aPairs].filter((pair) => bPairs.has(pair)).length
  return shared / Math.max(aPairs.size, bPairs.size)
}

export function rememberCorrection(field: LearningField, from: string, to: string) {
  const source = from.trim()
  const target = to.trim()
  if (!source || !target || normalize(source) === normalize(target)) return
  if (field === 'carrier' && source === '待确认') return
  const rules = readRules().filter((rule) => !(rule.field === field && normalize(rule.from) === normalize(source)))
  rules.unshift({ field, from: source, to: target, updatedAt: new Date().toISOString() })
  writeRules(rules.slice(0, 100))
}

export function rememberCorrections(
  before: Pick<{ pickupSite: string; carrier: Carrier; productName: string }, LearningField>,
  after: Pick<{ pickupSite: string; carrier: Carrier; productName: string }, LearningField>
) {
  rememberCorrection('pickupSite', before.pickupSite, after.pickupSite)
  rememberCorrection('carrier', before.carrier, after.carrier)
  rememberCorrection('productName', before.productName, after.productName)
}

export function applyLearnedValue(field: LearningField, value: string) {
  const source = value.trim()
  if (!source) return source
  const match = readRules()
    .filter((rule) => rule.field === field)
    .map((rule) => ({ rule, score: similarity(source, rule.from) }))
    .filter(({ score }) => score >= .72)
    .sort((left, right) => right.score - left.score || right.rule.updatedAt.localeCompare(left.rule.updatedAt))[0]
  return match?.rule.to ?? source
}

export function applyLearnedCorrections<T extends { pickupSite: string; carrier: Carrier; productName: string }>(value: T): T {
  return {
    ...value,
    pickupSite: applyLearnedValue('pickupSite', value.pickupSite),
    carrier: applyLearnedValue('carrier', value.carrier) as Carrier,
    productName: applyLearnedValue('productName', value.productName)
  }
}

export function getLearningRuleCount() {
  return readRules().length
}

export function clearLearningRules() {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(STORAGE_KEY)
}
