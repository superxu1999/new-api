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

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { AssetsPanel } from './components/assets-panel'
import { RealPersonPanel } from './components/real-person-panel'

/** 云端素材库页面：素材管理 + 真人认证两个页签。 */
export function Assets() {
  const { t } = useTranslation()

  return (
    <div className='mx-auto max-w-5xl space-y-6 px-4 py-8'>
      <div className='space-y-1'>
        <h1 className='text-2xl font-semibold'>{t('Asset Library')}</h1>
        <p className='text-muted-foreground text-sm'>
          {t(
            'Manage cloud materials used by video generation: ingest images, videos or audio from a public URL, then reference them as asset://<id>.'
          )}
        </p>
      </div>

      <Tabs defaultValue='assets'>
        <TabsList>
          <TabsTrigger value='assets'>{t('Materials')}</TabsTrigger>
          <TabsTrigger value='real-person'>
            {t('Real-person verification')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value='assets' className='pt-4'>
          <AssetsPanel />
        </TabsContent>
        <TabsContent value='real-person' className='pt-4'>
          <RealPersonPanel />
        </TabsContent>
      </Tabs>
    </div>
  )
}
