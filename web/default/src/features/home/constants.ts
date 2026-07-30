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
 * Home page constants
 * Upstream providers showcased on the default home page
 */
import type { TFunction } from 'i18next'

export interface HomeProvider {
  /** LobeHub icon name, resolved via getLobeIcon */
  icon: string
  name: string
  /** Representative model families shown as chips */
  models: string[]
}

export const HOME_PROVIDERS: HomeProvider[] = [
  { icon: 'OpenAI', name: 'OpenAI', models: ['GPT-4o', 'o3', 'GPT-4.1'] },
  {
    icon: 'Claude.Color',
    name: 'Anthropic',
    models: ['Claude Opus 4', 'Claude Sonnet 4'],
  },
  {
    icon: 'Gemini.Color',
    name: 'Google Gemini',
    models: ['Gemini 2.5 Pro', 'Gemini 2.5 Flash'],
  },
  {
    icon: 'DeepSeek.Color',
    name: 'DeepSeek',
    models: ['DeepSeek-V3', 'DeepSeek-R1'],
  },
  {
    icon: 'Qwen.Color',
    name: 'Alibaba Qwen',
    models: ['Qwen3', 'Qwen-Max'],
  },
  {
    icon: 'Doubao.Color',
    name: 'ByteDance Doubao',
    models: ['Doubao-pro', 'Seed 1.6'],
  },
  { icon: 'Moonshot.Color', name: 'Moonshot Kimi', models: ['Kimi K2'] },
  { icon: 'Grok.Color', name: 'xAI', models: ['Grok 4', 'Grok 3'] },
  {
    icon: 'Mistral.Color',
    name: 'Mistral AI',
    models: ['Mistral Large', 'Codestral'],
  },
  { icon: 'Meta.Color', name: 'Meta Llama', models: ['Llama 4'] },
  { icon: 'Zhipu.Color', name: 'Zhipu GLM', models: ['GLM-4.5'] },
  { icon: 'Minimax.Color', name: 'MiniMax', models: ['MiniMax-M1'] },
  { icon: 'Azure.Color', name: 'Azure OpenAI', models: ['GPT-4o', 'o3'] },
  {
    icon: 'Bedrock.Color',
    name: 'AWS Bedrock',
    models: ['Claude', 'Llama', 'Nova'],
  },
  {
    icon: 'VertexAI.Color',
    name: 'Vertex AI',
    models: ['Gemini', 'Claude'],
  },
  {
    icon: 'Volcengine.Color',
    name: 'Volcengine',
    models: ['Doubao', 'DeepSeek'],
  },
  {
    icon: 'Perplexity.Color',
    name: 'Perplexity',
    models: ['Sonar', 'Sonar Pro'],
  },
  { icon: 'Ollama.Color', name: 'Ollama', models: ['Local Models'] },
]

/** Extra providers supported beyond the ones listed above */
export const MORE_PROVIDERS_COUNT = 30

// Stats strip - Default statistics
export const DEFAULT_STATS = [
  {
    value: '50',
    suffix: '+',
    description: 'upstream services integrated',
  },
  {
    value: '100',
    suffix: '+',
    description: 'model billing support',
  },
  {
    value: '50',
    suffix: '+',
    description: 'compatible API routes',
  },
  {
    value: '10',
    suffix: '+',
    description: 'scheduling controls',
  },
] as const

export function getDefaultStats(t: TFunction) {
  return DEFAULT_STATS.map((stat) => ({
    ...stat,
    description: t(stat.description),
  }))
}
