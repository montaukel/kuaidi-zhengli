import type { Carrier } from './types'

const officialPages: Partial<Record<Carrier, string>> = {
  '韵达': 'https://www.yundaex.com/',
  '圆通': 'https://www.yto.net.cn/',
  '中通': 'https://www.zto.com/',
  '申通': 'https://www.sto.cn/',
  '顺丰': 'https://www.sf-express.com/chn/sc/dynamic_function/waybill/',
  '极兔': 'https://www.jtexpress.cn/',
  '京东物流': 'https://www.jdl.com/',
  '邮政 EMS': 'https://www.ems.com.cn/'
}

export function getOfficialPage(carrier: Carrier) {
  return officialPages[carrier]
}
