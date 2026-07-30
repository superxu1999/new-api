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
import { ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

import { getDefaultStats } from '../../constants'

interface ClosingProps {
  className?: string
  isAuthenticated?: boolean
}

export function Closing(props: ClosingProps) {
  const { t } = useTranslation()
  const stats = getDefaultStats(t)

  return (
    <section className='px-6 pt-6 pb-16 md:pb-24'>
      <div className='border-border/60 mx-auto flex max-w-6xl flex-col gap-10 border-t pt-10 md:pt-14'>
        {/* Inline stats — numbers only, no cards */}
        <dl className='grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-4'>
          {stats.map((stat) => (
            <div key={stat.description}>
              <dd className='font-mono text-3xl font-semibold tracking-tight tabular-nums md:text-4xl'>
                {stat.value}
                <span className='text-emerald-600 dark:text-emerald-400'>
                  {stat.suffix}
                </span>
              </dd>
              <dt className='text-muted-foreground mt-1.5 font-mono text-[11px] tracking-wider uppercase'>
                {stat.description}
              </dt>
            </div>
          ))}
        </dl>

        {/* Single closing line + action */}
        <div className='flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center'>
          <span className='max-w-md text-lg font-semibold tracking-tight text-balance md:text-xl'>
            {t('Ready to route your first request?')}
          </span>
          <Button
            className='group h-11 shrink-0 rounded-lg px-5 text-sm font-medium'
            render={
              <Link to={props.isAuthenticated ? '/dashboard' : '/sign-up'} />
            }
          >
            {props.isAuthenticated ? t('Go to Dashboard') : t('Get Started')}
            <ArrowRight className='ml-1.5 size-4 transition-transform duration-200 group-hover:translate-x-0.5' />
          </Button>
        </div>
      </div>
    </section>
  )
}
