/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useSystemConfigStore } from '@/stores/system-config-store'

/**
 * 模型倍率（ModelRatio）与展示价格之间的换算系数。
 *
 * 计费口径：1M tokens 消耗 `ratio × 1e6` 个 quota，而展示金额 = quota / QuotaPerUnit。
 * 因此 `1M tokens 的展示价格 = ratio × 1e6 / QuotaPerUnit`。
 *
 * 标准站点 QuotaPerUnit = 500000（1 USD = 500000 quota），系数正好是 2，
 * 即 ratio 1 ≈ 2 美元/百万 token；本实例把 QuotaPerUnit 改成 68493，
 * 系数变成 14.6027，价格直接以人民币展示。
 *
 * 之前前端把系数硬编码成 2，导致模型广场的金额比实际扣费小 (QuotaPerUnit 偏差) 倍。
 */
export function getRatioPriceFactor(quotaPerUnit: number): number {
  if (!Number.isFinite(quotaPerUnit) || quotaPerUnit <= 0) {
    return 2
  }
  return 1_000_000 / quotaPerUnit
}

/** 从全局配置读取当前站点的换算系数（配置在应用启动时写入 store）。 */
export function getCurrentRatioPriceFactor(): number {
  return getRatioPriceFactor(
    useSystemConfigStore.getState().config.currency.quotaPerUnit
  )
}

/** 倍率 → 每百万 token 的展示价格 */
export function ratioToUnitPrice(ratio: number): number {
  return ratio * getCurrentRatioPriceFactor()
}

/** 每百万 token 的展示价格 → 倍率 */
export function unitPriceToRatio(price: number): number {
  return price / getCurrentRatioPriceFactor()
}
