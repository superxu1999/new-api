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
import { useTranslation } from 'react-i18next'

import { getLobeIcon } from '@/lib/lobe-icon'

import { HOME_PROVIDERS, MORE_PROVIDERS_COUNT } from '../../constants'

interface ProviderMarqueeProps {
  className?: string
}

export function ProviderMarquee(_props: ProviderMarqueeProps) {
  const { t } = useTranslation()

  return (
    <section className='py-10 md:py-14'>
      <div className='mx-auto mb-7 flex max-w-6xl items-baseline justify-between px-6'>
        <span className='text-muted-foreground/60 font-mono text-[11px] tracking-[0.2em] uppercase'>
          {t('Supported Providers')}
        </span>
        <span className='text-muted-foreground/40 font-mono text-[11px] tabular-nums'>
          {t('{{count}}+ upstreams', {
            count: HOME_PROVIDERS.length + MORE_PROVIDERS_COUNT,
          })}
        </span>
      </div>

      {/* Edge-faded infinite marquee */}
      <div
        role='list'
        aria-label={t('Supported Providers')}
        className='relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]'
      >
        <div className='landing-marquee-track flex w-max items-center gap-3 pr-3'>
          {['a', 'b'].map((copy) =>
            HOME_PROVIDERS.map((provider) => (
              <div
                role='listitem'
                key={`${copy}-${provider.name}`}
                aria-hidden={copy === 'b'}
                className='border-border/50 bg-background/60 text-muted-foreground hover:border-border hover:text-foreground flex shrink-0 items-center gap-2.5 rounded-full border px-5 py-2.5 backdrop-blur-xs transition-colors duration-300'
              >
                <span className='shrink-0' aria-hidden>
                  {getLobeIcon(provider.icon, 20)}
                </span>
                <span className='text-sm font-medium whitespace-nowrap'>
                  {provider.name}
                </span>
                <span className='text-muted-foreground/40 font-mono text-[10.5px] whitespace-nowrap'>
                  {provider.models[0]}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  )
}
