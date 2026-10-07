/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

/**
 * 失败原因人话化：把上游返回的英文错误（通常夹带 Request ID）翻译成
 * 「一句用户看得懂的话 + 一句该怎么办」。
 *
 * C 端用户不该看到 "The request failed because the output video may be related
 * to copyright restrictions. Request id: 02179...ffffac175b6959b537" 这种原文。
 * 原文不丢——放进 details 里，复制给客服/运维排查仍然可用。
 *
 * 规则按「上游错误的稳定特征词」匹配（不依赖精确文案，上游措辞微调也能命中）；
 * 匹配不到就保留原文当标题——信息宁可裸露，不可瞎编。
 */

export interface FriendlyError {
  /** 用户看得懂的一句话（i18n key）。 */
  titleKey: string
  /** 用户下一步该怎么办（i18n key）；空串表示没有可给的建议。 */
  hintKey: string
  /** 上游原文（Request ID 等排查信息），详情里展示。 */
  raw: string
}

const ERROR_RULES: Array<{
  pattern: RegExp
  titleKey: string
  hintKey: string
}> = [
  {
    pattern: /copyright|infring/i,
    titleKey: 'Content blocked due to copyright restrictions',
    hintKey: 'Adjust the prompt or replace the reference material, then try again.',
  },
  {
    pattern: /sensitive|risk[_ ]?control|content.?policy|safety|moderation|违规|敏感/i,
    titleKey: "Content flagged by the platform's safety review",
    hintKey: 'Remove sensitive elements from the prompt and try again.',
  },
  {
    pattern: /quota|insufficient|balance|余额/i,
    titleKey: 'Insufficient quota',
    hintKey: 'Top up your balance, then try again.',
  },
  {
    pattern: /timed?\s?out|deadline|超时/i,
    titleKey: 'Generation timed out',
    hintKey: 'The upstream took too long. Please try again later.',
  },
  {
    pattern: /rate.?limit|too many|频率|限流/i,
    titleKey: 'Too many requests',
    hintKey: 'Please wait a moment and try again.',
  },
  {
    pattern: /not support|unsupported|不能|不支持|capability/i,
    titleKey: 'The model cannot handle this input combination',
    hintKey: 'Remove some materials or pick a different model.',
  },
  {
    pattern: /cancel/i,
    titleKey: 'Task canceled',
    hintKey: '',
  },
]

/** 把上游失败原因翻译成人话；匹配不到时原样返回（hint 为空）。 */
export function friendlyTaskError(failReason: string): FriendlyError {
  const raw = failReason.trim()
  for (const rule of ERROR_RULES) {
    if (rule.pattern.test(raw)) {
      return { titleKey: rule.titleKey, hintKey: rule.hintKey, raw }
    }
  }
  return { titleKey: '', hintKey: '', raw }
}
