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
import { Link } from '@tanstack/react-router'
import { ArrowRight, BookOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useStatus } from '@/hooks/use-status'

import { HeroTerminalDemo } from '../hero-terminal-demo'

interface HeroProps {
  className?: string
  isAuthenticated?: boolean
}

export function Hero(props: HeroProps) {
  const { t } = useTranslation()
  const { status } = useStatus()
  const docsUrl =
    (status?.docs_link as string | undefined) || 'https://docs.newapi.pro'
  const docsIsExternal = docsUrl.startsWith('http')

  const primaryButton = (
    <Button
      className='group h-12 rounded-lg px-6 text-[15px] font-medium'
      render={<Link to={props.isAuthenticated ? '/dashboard' : '/sign-up'} />}
    >
      {props.isAuthenticated ? t('Go to Dashboard') : t('Get Started')}
      <ArrowRight className='ml-1.5 size-4 transition-transform duration-200 group-hover:translate-x-0.5' />
    </Button>
  )

  const docsLink = docsIsExternal ? (
    <a
      href={docsUrl}
      target='_blank'
      rel='noopener noreferrer'
      className='text-muted-foreground hover:text-foreground group inline-flex h-12 items-center gap-1.5 text-sm font-medium transition-colors'
    >
      <BookOpen className='size-4' />
      <span>{t('Docs')}</span>
      <span className='text-muted-foreground/40 transition-transform duration-200 group-hover:translate-x-0.5'>
        -&gt;
      </span>
    </a>
  ) : (
    <Link
      to={docsUrl}
      className='text-muted-foreground hover:text-foreground group inline-flex h-12 items-center gap-1.5 text-sm font-medium transition-colors'
    >
      <BookOpen className='size-4' />
      <span>{t('Docs')}</span>
      <span className='text-muted-foreground/40 transition-transform duration-200 group-hover:translate-x-0.5'>
        -&gt;
      </span>
    </Link>
  )

  return (
    <section className='relative px-6 pt-20 pb-16 md:pt-28 md:pb-24'>
      {/* Fine grid, faded edges */}
      <div
        aria-hidden
        className='absolute inset-0 -z-10 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_75%_65%_at_50%_20%,black_20%,transparent_100%)] bg-[size:3.5rem_3.5rem] opacity-[0.08] dark:opacity-[0.12]'
      />
      {/* Single breathing glow anchoring the terminal */}
      <div
        aria-hidden
        className='landing-glow-breathe pointer-events-none absolute top-1/2 right-[-10%] -z-10 h-[520px] w-[720px] -translate-y-1/2 [--landing-glow-opacity:0.45] dark:[--landing-glow-opacity:0.3]'
        style={{
          background:
            'radial-gradient(ellipse 55% 55% at 50% 50%, oklch(0.75 0.13 165 / 42%) 0%, oklch(0.68 0.14 235 / 20%) 50%, transparent 75%)',
        }}
      />

      <div className='mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 lg:grid-cols-12'>
        {/* Left: display type + one action */}
        <div className='flex flex-col items-start text-left lg:col-span-6'>
          <div
            className='landing-animate-fade-up text-muted-foreground inline-flex items-center gap-2 font-mono text-xs tracking-wider opacity-0'
            style={{ animationDelay: '0ms' }}
          >
            <span className='relative flex size-1.5'>
              <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75' />
              <span className='relative inline-flex size-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400' />
            </span>
            <span className='text-emerald-600 dark:text-emerald-400'>$</span>
            <span>curl your-domain/v1/chat/completions</span>
          </div>

          <h1
            className='landing-animate-fade-up mt-6 text-[clamp(2.75rem,6.5vw,4.75rem)] leading-[1.02] font-bold tracking-[-0.03em] text-balance opacity-0'
            style={{ animationDelay: '80ms' }}
          >
            {t('Every model.')}
            <br />
            <span className='bg-gradient-to-r from-emerald-500 via-teal-400 to-blue-500 bg-clip-text text-transparent dark:from-emerald-400 dark:via-teal-300 dark:to-blue-400'>
              {t('One API.')}
            </span>
          </h1>

          <p
            className='landing-animate-fade-up text-muted-foreground mt-6 max-w-md text-[15px] leading-relaxed opacity-0 md:text-base'
            style={{ animationDelay: '160ms' }}
          >
            {t(
              'Route, load-balance, and bill across upstream providers through a single OpenAI-compatible API.'
            )}
          </p>

          <div
            className='landing-animate-fade-up mt-9 flex flex-wrap items-center gap-5 opacity-0'
            style={{ animationDelay: '240ms' }}
          >
            {primaryButton}
            {docsLink}
          </div>
        </div>

        {/* Right: live API demo */}
        <div
          className='landing-animate-fade-up flex w-full justify-center opacity-0 lg:col-span-6'
          style={{ animationDelay: '340ms' }}
        >
          <HeroTerminalDemo className='w-full' />
        </div>
      </div>
    </section>
  )
}
